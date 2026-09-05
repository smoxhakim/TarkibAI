/**
 * Centralised user-facing UI strings.
 *
 * The UI chrome is English; the AI conversation layer is Moroccan Darija and is
 * NOT routed through this module. Keeping strings in one place means a second
 * chrome language (French was the alternative considered) can be added later
 * without touching component code.
 */
export const strings = {
  app: {
    name: 'TARKIB',
    tagline: 'AI Fabrication & Design Platform',
  },
  nav: {
    dashboard: 'Projects',
    signIn: 'Sign in',
    signUp: 'Get started',
  },
  landing: {
    heading: 'From an idea to a production-ready project.',
    body: 'Describe your fabrication project in Moroccan Darija. TARKIB turns the conversation into a structured specification, deterministic material calculations, cutting plans, costs, and the documents your client and your workshop need.',
    cta: 'Get started',
    ctaSignedIn: 'Go to your projects',
  },
  projects: {
    title: 'Projects',
    subtitle: 'Every project keeps its conversation, specification, calculations, and documents together.',
    empty: 'No projects yet.',
    emptyHint: 'Create your first project to start a conversation about it.',
    emptyArchived: 'No archived projects.',
    create: 'New project',
    creating: 'Creating…',
    titleLabel: 'Project title',
    titlePlaceholder: 'e.g. Restaurant facade — Casablanca',
    open: 'Open',
    rename: 'Rename',
    renaming: 'Saving…',
    save: 'Save',
    cancel: 'Cancel',
    archive: 'Archive',
    archiving: 'Archiving…',
    restore: 'Restore',
    restoring: 'Restoring…',
    delete: 'Delete permanently',
    deleting: 'Deleting…',
    deleteConfirmTitle: 'Delete this project permanently?',
    deleteConfirmBody:
      'This removes the project and everything derived from it — conversation, specification, calculations, cutting plans, costs, and documents. This cannot be undone. Archiving keeps the project recoverable instead.',
    deleteConfirmAction: 'Yes, delete permanently',
    showArchived: 'Show archived',
    hideArchived: 'Hide archived',
    createdOn: 'Created',
    updatedOn: 'Updated',
  },
  status: {
    intake: 'Intake',
    spec_approved: 'Spec approved',
    calculated: 'Calculated',
    quoted: 'Quoted',
    production_ready: 'Production ready',
    archived: 'Archived',
  },
  errors: {
    generic: 'Something went wrong.',
    retry: 'Try again',
    loadProjects: 'Could not load your projects.',
    projectNotFound: 'This project does not exist, or you do not have access to it.',
    titleRequired: 'A project title is required.',
    titleTooLong: 'Project titles are limited to 200 characters.',
  },
  workspace: {
    comingSoon: 'Not built yet',
    conversation: 'Conversation',
    conversationNote:
      'The Moroccan Darija conversation is built in Phase 1. Nothing here is mocked — the panel stays empty until it genuinely works.',
    specification: 'Specification',
    specificationNote: 'The structured project specification is built in Phase 1.',
    materials: 'Materials & calculations',
    materialsNote: 'Deterministic material calculations arrive in Phases 3 and 4.',
    documents: 'Documents',
    documentsNote: 'Client quotations and production documents arrive in Phases 13 and 14.',
    backToProjects: '← All projects',
  },
} as const;
