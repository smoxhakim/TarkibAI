import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { removeExpense } from '@/lib/calc/costs/service';

type RouteContext = { params: Promise<{ id: string; expenseId: string }> };

// DELETE /api/projects/:id/expenses/:expenseId
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    const { id, expenseId } = await params;
    await removeExpense(id, user.id, expenseId);
    return { deleted: true };
  });
}
