/**
 * A playbook in plain words, everywhere an agent reads one: the playbooks
 * block (the Writer, a trigger run on a watch's review), the analyst's
 * playbook lines, a stock's playbook checks, and read_knowledge_library. No
 * data-model path (`chart.base.pivot`, `Thesis.catalystDate`), no ticket id,
 * no section of a document the agent never sees, and no `{placeholder}` or
 * JSON outside a watch trigger's form as written, which an agent still types.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: async () => ({}) }));
jest.mock("@/lib/agent/knowledge/load-playbook", () => {
  const { playbookTemplates } = jest.requireActual("@/lib/agent/knowledge/playbooks");
  return { loadPlaybook: async (_a: string, id: string) => playbookTemplates(null, id), loadPlaybooks: async () => (id: string) => playbookTemplates(null, id) };
});
import { SETUPS } from "./setups";
import { playbooksBlock, playbookTemplates } from "./playbooks";
import { setupChecklist } from "./setup-checklist";
import { playbookChecks } from "@/lib/agent/analyst-brief";
import { readKnowledgeLibrary } from "@/lib/agent/tools/read-knowledge-library";
import { createToolContext } from "@/lib/agent/tool-context";

const NOT_PLAIN = [/\b(chart|Thesis|Position|setup)\.[a-z]/, /DAV-\d+/, /\bPart [A-Z]\d?\b/, /\bruling \d\b/];
const typed = (line: string) => line.trimStart().startsWith("As written: ");
const problems = (text: string) =>
  text.split("\n").flatMap((line) => [
    ...NOT_PLAIN.filter((re) => re.test(line)).map((re) => `${re}: ${line.trim().slice(0, 120)}`),
    ...(!typed(line) && /\{[a-zA-Z0-9]+\}|"watch":/.test(line) && !line.trimStart().startsWith("Each chart number, by its mark") ? [`placeholder or JSON: ${line.trim().slice(0, 120)}`] : []),
  ]);

describe("a playbook in plain words, everywhere an agent reads one", () => {
  it("the playbooks block the Writer and a trigger run read", () => {
    expect(problems(playbooksBlock(SETUPS, (id) => playbookTemplates(null, id)))).toEqual([]);
  });

  it("each playbook's checks, as the analyst and a stock's row carry them", () => {
    for (const s of SETUPS) {
      expect(problems(playbookChecks(s).join("\n"))).toEqual([]);
      expect(problems((setupChecklist(s.id, { templates: playbookTemplates(null, s.id) })?.lines ?? []).join("\n"))).toEqual([]);
    }
  });

  it("read_knowledge_library's playbook, every one", async () => {
    const tool = readKnowledgeLibrary(createToolContext({ runId: "t", userId: "u" } as never)) as unknown as { execute: (a: unknown, o: unknown) => Promise<{ data: { content: string } }> };
    for (const s of SETUPS) {
      const r = await tool.execute({ topic: "setup", id: s.id }, { toolCallId: "t", messages: [] });
      expect([s.id, problems(r.data.content)]).toEqual([s.id, []]);
    }
  });
});
