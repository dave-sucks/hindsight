'use server';

import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { inngest } from '@/lib/inngest/client';
import { redirect } from 'next/navigation';

export const signUpWithEmail = async ({ email, password, fullName, country, investmentGoals, riskTolerance, preferredIndustry }: SignUpFormData) => {
    try {
        const supabase = await createClient();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name: fullName } },
        });

        if (error) throw error;

        if (data.user) {
            await prisma.user.create({
                data: {
                    id: data.user.id,
                    email,
                    name: fullName,
                    country,
                    investmentGoals,
                    riskTolerance,
                    preferredIndustry,
                },
            });

            await inngest.send({
                name: 'app/user.created',
                data: { email, name: fullName, country, investmentGoals, riskTolerance, preferredIndustry },
            });
        }

        return { success: true };
    } catch (e) {
        console.error('Sign up failed', e);
        return { success: false, error: 'Sign up failed' };
    }
};

export const signInWithEmail = async ({ email, password }: SignInFormData) => {
    try {
        const supabase = await createClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) throw error;

        return { success: true };
    } catch (e) {
        console.error('Sign in failed', e);
        return { success: false, error: 'Invalid email or password' };
    }
};

export const signOut = async () => {
    try {
        const supabase = await createClient();
        await supabase.auth.signOut();
        redirect('/sign-in');
    } catch (e) {
        console.error('Sign out failed', e);
        return { success: false, error: 'Sign out failed' };
    }
};
