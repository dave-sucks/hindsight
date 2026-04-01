// Barrel re-export — keeps existing imports from "@/components/assistant-ui/tool-uis" working
export {
  ToolUICallbacksProvider,
  useToolUICallbacks,
  SourceChips,
  extractToolSources,
  type SourceData,
  type ToolUICallbacks,
} from "./tool-ui-shared";

export {
  SuggestConfigRender,
  SuggestConfigEditorRender,
} from "./tool-ui-config";

export {
  useRegisterResearchToolUIs,
  useRegisterBuilderToolUIs,
} from "./tool-ui-research";

export {
  useRegisterFollowupToolUIs,
} from "./tool-ui-followup";
