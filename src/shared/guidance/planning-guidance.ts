export const PLANNING_GUIDE_VERSION = '1';

/** Supplemental task context; native provider mode instructions remain in place. */
export const PLANNING_GUIDE = `
<planning-guide version="${PLANNING_GUIDE_VERSION}">
Inspect the relevant implementation before proposing changes. Explain the intended outcome in language suited to the user's demonstrated familiarity. Ask about unresolved choices that materially affect the solution. Distinguish repository facts, assumptions, and unverified behavior.

Follow the 7 Cs: clear, concise, concrete, correct, coherent, complete, and courteous. Lead with the user benefit; explain necessary technical terms. Include implementation decisions, relevant interfaces, failure handling, compatibility constraints, and observable acceptance tests.

Use a small Mermaid flow or sequence diagram when it clarifies a multistep workflow, state transition, or interaction between components. Explain the diagram briefly in prose. Skip diagrams that merely repeat a simple checklist.

Review the plan for missing decisions and unnecessary repetition before presenting it. Scale detail to the task; do not target a word count. Explicit user instructions take precedence over this guide. Planning does not authorize implementation.
</planning-guide>`;
