"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldBan, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  fetchIdentityCandidates,
  fetchIdentityProviderUsage,
  generateIdentityLeadBrief,
  reviewIdentityCandidate,
} from "@/api/analytics/endpoints/users";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";

const trait = (value: unknown) => (typeof value === "string" && value.trim() ? value : "—");

export function IdentityCandidatesTable() {
  const { site } = useParams<{ site: string }>();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [highIntentOnly, setHighIntentOnly] = useState(false);
  const [briefText, setBriefText] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: ["identity-candidates", site],
    queryFn: () => fetchIdentityCandidates(site),
  });
  const usage = useQuery({
    queryKey: ["identity-provider-usage", site],
    queryFn: () => fetchIdentityProviderUsage(site),
  });
  const review = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "reject" | "suppress"; sendToCrm?: boolean }) =>
      reviewIdentityCandidate(site, input.id, input.action, input.sendToCrm),
    onSuccess: () => {
      toast.success("Candidate review saved");
      void queryClient.invalidateQueries({ queryKey: ["identity-candidates", site] });
      void queryClient.invalidateQueries({ queryKey: ["users", site] });
    },
    onError: () => toast.error("Candidate review failed"),
  });
  const brief = useMutation({
    mutationFn: (id: string) => generateIdentityLeadBrief(site, id),
    onSuccess: result => {
      toast.success("Lead brief generated");
      void queryClient.invalidateQueries({ queryKey: ["identity-candidates", site] });
      setBriefText(result.brief);
    },
    onError: () => toast.error("Lead brief generation failed"),
  });
  if (candidates.isError) {
    return (
      <ErrorState title="Failed to load possible matches" message="The identity candidate queue is unavailable." />
    );
  }
  const totals = usage.data?.totals;
  const rows = (candidates.data?.data ?? []).filter(
    row => (status === "all" || row.reviewStatus === status) && (!highIntentOnly || (row.icpScore ?? 0) >= 70)
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Provider requests", totals?.requests ?? 0],
          ["Matches", totals?.matches ?? 0],
          ["Failures", totals?.failures ?? 0],
          ["Estimated cost", `$${(totals?.estimatedCostDollars ?? 0).toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      {briefText && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          <div className="mb-1 font-semibold">AI lead brief</div>
          <p>{briefText}</p>
          <button type="button" onClick={() => setBriefText(null)} className="mt-2 text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Possible matches</h2>
          <p className="text-sm text-neutral-500">Probable identities stay unlinked until a person reviews them.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={highIntentOnly}
              onChange={event => setHighIntentOnly(event.target.checked)}
            />
            High ICP score
          </label>
          <select
            aria-label="Candidate review status"
            value={status}
            onChange={event => setStatus(event.target.value as typeof status)}
            className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="p-3">Person</th>
              <th className="p-3">Company / title</th>
              <th className="p-3">Confidence</th>
              <th className="p-3">Source</th>
              <th className="p-3">ICP</th>
              <th className="p-3">Provenance</th>
              <th className="p-3 text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {candidates.isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td colSpan={7} className="p-3">
                    <div className="h-6 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-500">
                  No candidates in this state.
                </td>
              </tr>
            ) : (
              rows.map(candidate => (
                <tr key={candidate.id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="p-3">
                    <div className="font-medium">{trait(candidate.traits.name)}</div>
                    <div className="text-neutral-500">{trait(candidate.traits.email)}</div>
                  </td>
                  <td className="p-3">
                    <div>{trait(candidate.traits.company)}</div>
                    <div className="text-neutral-500">{trait(candidate.traits.title)}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{Math.round(candidate.confidence * 100)}%</div>
                    <div className="text-xs capitalize text-neutral-500">{candidate.matchMethod}</div>
                  </td>
                  <td className="p-3 uppercase">{candidate.provider.replace("_", " ")}</td>
                  <td className="p-3 font-medium">{candidate.icpScore ?? "—"}</td>
                  <td className="p-3">
                    <details>
                      <summary className="cursor-pointer">{candidate.provenance.length} fields</summary>
                      <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                        {candidate.provenance.map((item, index) => (
                          <li key={`${item.field}-${index}`}>
                            {item.field}: {item.provider} ({Math.round(item.confidence * 100)}%)
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="p-3">
                    {candidate.reviewStatus === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => review.mutate({ id: candidate.id, action: "reject" })}
                          disabled={review.isPending}
                          aria-label="Reject candidate"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => review.mutate({ id: candidate.id, action: "suppress" })}
                          disabled={review.isPending}
                          aria-label="Suppress candidate"
                        >
                          <ShieldBan className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => brief.mutate(candidate.id)}
                          disabled={brief.isPending}
                        >
                          Brief
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => review.mutate({ id: candidate.id, action: "approve" })}
                          disabled={review.isPending}
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => review.mutate({ id: candidate.id, action: "approve", sendToCrm: true })}
                          disabled={review.isPending}
                        >
                          Approve + GHL
                        </Button>
                      </div>
                    ) : (
                      <div className="text-right capitalize text-neutral-500">{candidate.reviewStatus}</div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
