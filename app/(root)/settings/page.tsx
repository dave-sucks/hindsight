import { getAgentConfig } from "@/lib/actions/settings.actions";
import SettingsPage from "@/components/settings/SettingsPage";

export default async function Settings() {
  const config = await getAgentConfig();
  return <SettingsPage config={config} />;
}
