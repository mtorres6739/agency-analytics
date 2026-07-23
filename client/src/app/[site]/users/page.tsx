"use client";

import { useExtracted } from "next-intl";
import { DisabledOverlay } from "../../../components/DisabledOverlay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/basic-tabs";
import { useSetPageTitle } from "../../../hooks/useSetPageTitle";
import { USER_PAGE_FILTERS } from "../../../lib/filterGroups";
import { SubHeader } from "../components/SubHeader/SubHeader";
import { TraitsExplorer } from "./components/TraitsExplorer";
import { UsersTable } from "./components/UsersTable";
import { IdentityCandidatesTable } from "./components/IdentityCandidatesTable";

export default function UsersPage() {
  useSetPageTitle("Users");
  const t = useExtracted();

  return (
    <DisabledOverlay message={t("Users")} featurePath="users">
      <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-3">
        <SubHeader availableFilters={USER_PAGE_FILTERS} />
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">{t("Users")}</TabsTrigger>
            <TabsTrigger value="traits">{t("Traits")}</TabsTrigger>
            <TabsTrigger value="matches">{t("Possible matches")}</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersTable />
          </TabsContent>
          <TabsContent value="traits">
            <TraitsExplorer />
          </TabsContent>
          <TabsContent value="matches">
            <IdentityCandidatesTable />
          </TabsContent>
        </Tabs>
      </div>
    </DisabledOverlay>
  );
}
