'use server';

import { prisma } from '@/lib/prisma';

export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
    if (!email) return [];

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: { watchlist: { select: { symbol: true } } },
        });

        if (!user) return [];

        return user.watchlist.map((item) => item.symbol);
    } catch (err) {
        console.error('getWatchlistSymbolsByEmail error:', err);
        return [];
    }
}
