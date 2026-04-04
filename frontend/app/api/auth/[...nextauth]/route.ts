import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { getAuthOptions } from '@/lib/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandlerContext = { params: any };

export async function GET(req: NextRequest, ctx: RouteHandlerContext) {
  return NextAuth(req, ctx, getAuthOptions(req));
}

export async function POST(req: NextRequest, ctx: RouteHandlerContext) {
  return NextAuth(req, ctx, getAuthOptions(req));
}
