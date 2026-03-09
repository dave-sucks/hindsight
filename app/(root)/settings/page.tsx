import { getAllAgentConfigs, getAgentConfig } from "@/lib/actions/settings.actions";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnalystsPage from "@/components/settings/AnalystsPage";
import SettingsPage from "@/components/settings/SettingsPage";

export default async function Settings() {
  const [configs, config] = await Promise.all([
    getAllAgentConfigs(),
    getAgentConfig(),
  ]);

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <Separator />
      <Tabs defaultValue="analysts">
        <TabsList>
          <TabsTrigger value="analysts">Analysts</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>
        <TabsContent value="analysts" className="mt-4">
          <AnalystsPage initialConfigs={configs} />
        </TabsContent>
        <TabsContent value="general" className="mt-4">
          <SettingsPage config={config} embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
