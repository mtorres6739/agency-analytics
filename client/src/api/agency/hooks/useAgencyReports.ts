import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReportSchedule,
  fetchReportRuns,
  fetchReportSchedules,
  retryReportRun,
  type CreateReportScheduleInput,
} from "../endpoints/reports";

const scheduleKey = (organizationId?: string, clientId?: string) => [
  "agency-report-schedules",
  organizationId,
  clientId,
];
const runKey = (organizationId?: string, clientId?: string) => ["agency-report-runs", organizationId, clientId];

export function useReportSchedules(organizationId?: string, clientId?: string) {
  return useQuery({
    queryKey: scheduleKey(organizationId, clientId),
    queryFn: () => fetchReportSchedules(organizationId!, clientId!),
    enabled: !!organizationId && !!clientId,
  });
}

export function useReportRuns(organizationId?: string, clientId?: string) {
  return useQuery({
    queryKey: runKey(organizationId, clientId),
    queryFn: () => fetchReportRuns(organizationId!, clientId!),
    enabled: !!organizationId && !!clientId,
  });
}

export function useCreateReportSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      organizationId,
      clientId,
      data,
    }: {
      organizationId: string;
      clientId: string;
      data: CreateReportScheduleInput;
    }) => createReportSchedule(organizationId, clientId, data),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: scheduleKey(variables.organizationId, variables.clientId) }),
  });
}

export function useRetryReportRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, clientId, runId }: { organizationId: string; clientId: string; runId: string }) =>
      retryReportRun(organizationId, clientId, runId),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: runKey(variables.organizationId, variables.clientId) }),
  });
}
