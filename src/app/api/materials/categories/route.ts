import type { NextRequest } from 'next/server';
import { requireDbUser } from '@/lib/auth/current-user';
import { handleRoute } from '@/lib/http/api';
import { listCategories } from '@/lib/materials/service';

// GET /api/materials/categories — categories actually in use, for filtering
export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireDbUser();
    return { categories: await listCategories(user.id) };
  });
}
