/**
 * Project workflow stages.
 *
 * Archiving is NOT a stage — it is tracked by Project.archivedAt so that a
 * restored project returns to the stage it had reached. See ARCHITECTURE §4.5.
 */
export const PROJECT_STAGES = [
  'intake',
  'spec_approved',
  'calculated',
  'quoted',
  'production_ready',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export function isProjectStage(value: string): value is ProjectStage {
  return (PROJECT_STAGES as readonly string[]).includes(value);
}

/**
 * Stages advance in order. Each stage depends on the output of the one before
 * it, so skipping ahead would mean deriving a quote from calculations that were
 * never run. Moving backwards IS allowed: when an approved input changes,
 * downstream results go stale and the project returns to an earlier stage.
 *
 * Stage transitions are currently driven by the application only. The AI agent
 * gets no ability to advance a stage without an explicit user approval (PRD §5.4).
 */
export function canTransition(from: ProjectStage, to: ProjectStage): boolean {
  if (from === to) return true;
  const fromIndex = PROJECT_STAGES.indexOf(from);
  const toIndex = PROJECT_STAGES.indexOf(to);
  return toIndex < fromIndex || toIndex === fromIndex + 1;
}

/** The display state of a project, combining stage and archived flag. */
export type ProjectDisplayStatus = ProjectStage | 'archived';

export function displayStatus(project: { status: string; archivedAt: Date | null }): ProjectDisplayStatus {
  if (project.archivedAt) return 'archived';
  return isProjectStage(project.status) ? project.status : 'intake';
}
