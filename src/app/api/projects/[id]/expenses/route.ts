import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute, readJson } from '@/lib/http/api';
import { expenseSchema } from '@/lib/calc/costs/schema';
import { addExpense, listExpenses } from '@/lib/calc/costs/service';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/:id/expenses — internal one-off expenses
export async function GET(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    return { expenses: await listExpenses(id, user.id) };
  });
}

// POST /api/projects/:id/expenses — { label, amountCents }
export async function POST(req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id } = await params;
    const input = expenseSchema.parse(await readJson(req));
    return { expenses: await addExpense(id, user.id, input) };
  });
}
