/**
 * What the agent is allowed to reach, per role.
 *
 * Composition is a pure function of the caller's role, so the authorization
 * boundary of the whole AI surface is assertable without a database. That
 * matters more here than anywhere else in the AI layer: the chat is the one
 * place in TARKIB where a user's words turn into service calls, and before T21
 * it was built from `(projectId, userId)` alone — which made every tool
 * available to every member of the workspace, including the roles the cost and
 * edit permissions exist to stop.
 *
 * Nothing is executed here. These tests are about the SHAPE of the surface;
 * behaviour against real rows is covered in tools.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SIGNAGE } from '@/lib/domains/registry';
import { asWorkspaceId } from '@/lib/workspaces/access';
import { WORKSPACE_ROLES, can, type WorkspaceRole } from '@/lib/workspaces/permissions';
import type { ProjectAiAccess } from '../access';
import { buildToolbox } from './index';

const accessAs = (role: WorkspaceRole): ProjectAiAccess => ({
  projectId: 'project-1',
  workspaceId: asWorkspaceId('workspace-1'),
  userId: 'user-1',
  role,
  domain: SIGNAGE,
});

const namesFor = (role: WorkspaceRole) => buildToolbox(accessAs(role)).map((tool) => tool.name);

describe('the tool surface', () => {
  it('exposes no tool that approves anything, for any role', () => {
    for (const role of WORKSPACE_ROLES) {
      const names = namesFor(role);
      for (const forbidden of [
        'approve_spec',
        'approve_proposal',
        'approve_quote',
        'issue_quote',
        'issue_drawing',
      ]) {
        expect(names, `${role} must not have ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exposes no tool that mutates the canvas directly', () => {
    for (const role of WORKSPACE_ROLES) {
      const names = namesFor(role);
      for (const forbidden of ['update_canvas', 'apply_commands', 'seed_canvas', 'set_scene']) {
        expect(names, `${role} must not have ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never takes a project or a user as a tool argument', () => {
    for (const role of WORKSPACE_ROLES) {
      for (const tool of buildToolbox(accessAs(role))) {
        const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
        for (const key of Object.keys(properties)) {
          expect(key, `${tool.name}.${key}`).not.toMatch(/^(projectId|userId|workspaceId|ownerId)$/);
        }
      }
    }
  });

  it('gives every tool a name, a description and an object schema', () => {
    for (const tool of buildToolbox(accessAs('owner'))) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(40);
      expect((tool.parameters as { type?: string }).type).toBe('object');
    }
  });

  it('has no duplicate names', () => {
    const names = namesFor('owner');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('writing tools follow the permission matrix', () => {
  it('gives update_project_spec only to roles that may edit the project', () => {
    expect(namesFor('owner')).toContain('update_project_spec');
    expect(namesFor('designer')).toContain('update_project_spec');
    expect(namesFor('sales')).toContain('update_project_spec');
    expect(namesFor('production')).toContain('update_project_spec');
    // The role the edit permission exists to stop.
    expect(namesFor('worker')).not.toContain('update_project_spec');
  });

  it('gives propose_design_change only to roles that may edit the design', () => {
    expect(namesFor('owner')).toContain('propose_design_change');
    expect(namesFor('designer')).toContain('propose_design_change');
    for (const role of ['sales', 'production', 'worker'] as const) {
      expect(namesFor(role), role).not.toContain('propose_design_change');
    }
  });

  it('still lets every role read', () => {
    for (const role of WORKSPACE_ROLES) {
      const names = namesFor(role);
      expect(names, role).toContain('get_project_spec');
      expect(names, role).toContain('get_canvas');
      expect(names, role).toContain('get_material_calculations');
      expect(names, role).toContain('get_project_readiness');
    }
  });
});

describe('the financial boundary', () => {
  it('gives get_project_cost only to roles with cost.view', () => {
    for (const role of ['owner', 'admin', 'sales'] as const) {
      expect(namesFor(role), role).toContain('get_project_cost');
    }
    for (const role of ['designer', 'production', 'worker'] as const) {
      expect(namesFor(role), role).not.toContain('get_project_cost');
    }
  });

  /**
   * Narrowed in T22.1, and the narrowing is the point rather than a concession.
   *
   * A quotation's own subtotal, tax and total are CLIENT-FACING figures governed
   * by `quote.view` — `loadQuote` says so in as many words — and the production
   * role holds that permission while deliberately holding no `cost.view`. So
   * `get_quote` legitimately names tax to a cost-blind role, and a blanket ban
   * on the word would have to be dodged by calling it something else, which
   * protects nothing and makes the description less accurate.
   *
   * What still must not leak is INTERNAL cost, so the exclusion is exactly one
   * tool wide and the quote tool gets its own, stricter assertion below.
   */
  it('leaves the internal-cost descriptions out of a cost-blind toolbox', () => {
    for (const role of ['designer', 'production', 'worker'] as const) {
      const descriptions = buildToolbox(accessAs(role))
        .filter((tool) => tool.name !== 'get_quote')
        .map((tool) => `${tool.name} ${tool.description}`)
        .join(' ');
      expect(descriptions, role).not.toMatch(/\bmargin\b/i);
      expect(descriptions, role).not.toMatch(/\btax\b/i);
    }
  });

  it('never describes the quote tool in terms of internal cost', () => {
    for (const role of WORKSPACE_ROLES) {
      const quoteTool = buildToolbox(accessAs(role)).find((tool) => tool.name === 'get_quote');
      if (!quoteTool) continue;
      // A client price is not a cost. The tool may name what the client is
      // charged; it may never advertise the business's own figures.
      expect(quoteTool.description, role).not.toMatch(/\bmargin\b/i);
      expect(quoteTool.description, role).not.toMatch(/\bprofit\b/i);
      expect(quoteTool.description, role).not.toMatch(/internal cost/i);
    }
  });

  it('keeps the quantity tools available to production, which needs them', () => {
    const names = namesFor('production');
    expect(names).toContain('get_material_calculations');
    expect(names).toContain('get_cutting_plans');
    expect(names).toContain('list_materials');
    expect(names).toContain('get_material_recommendations');
  });
});

/* -------------------------------------------------------------------------- */
/* Quotations (T22.1)                                                         */
/* -------------------------------------------------------------------------- */

describe('the quote boundary', () => {
  it('gives get_quote only to roles with quote.view', () => {
    for (const role of WORKSPACE_ROLES) {
      const has = namesFor(role).includes('get_quote');
      // Derived from the matrix, so a role change breaks this rather than
      // silently passing.
      expect(has, role).toBe(can(role, 'quote.view'));
    }
  });

  it('gives it to production, who may read a quote and not a cost', () => {
    // The whole point of keeping the two permissions apart.
    expect(namesFor('production')).toContain('get_quote');
    expect(namesFor('production')).not.toContain('get_project_cost');
  });

  it('withholds it from designer and worker', () => {
    expect(namesFor('designer')).not.toContain('get_quote');
    expect(namesFor('worker')).not.toContain('get_quote');
  });

  it('exposes no tool that writes a quotation, for any role', () => {
    for (const role of WORKSPACE_ROLES) {
      for (const name of namesFor(role)) {
        expect(name, `${role} must not have ${name}`).not.toMatch(
          /create_quote|update_quote|delete_quote|issue_quote|approve_quote|quote_settings|quote_logo|send_quote/i
        );
      }
    }
  });

  it('takes no arguments at all, so it cannot address another project', () => {
    const quoteTool = buildToolbox(accessAs('sales')).find((tool) => tool.name === 'get_quote');
    expect(quoteTool).toBeDefined();
    const parameters = quoteTool!.parameters as {
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    expect(parameters.properties ?? {}).toEqual({});
    expect(parameters.additionalProperties).toBe(false);
  });
});
