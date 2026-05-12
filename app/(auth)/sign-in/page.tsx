'use client';

import { Suspense, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import InputField from '@/components/forms/InputField';
import FooterLink from '@/components/forms/FooterLink';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import { signInWithEmail } from "@/lib/actions/auth.actions";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";

const SignInInner = () => {
    const router = useRouter()
    const params = useSearchParams()

    // Invite-accept and other internal flows pass `next=/path/to/return/to`.
    // We constrain to relative paths so an attacker can't smuggle an
    // absolute redirect through the query string.
    const rawNext = params.get('next') ?? '/'
    const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

    // Prefill email when the invite-accept route bounced through here.
    const prefilledEmail = params.get('email') ?? ''

    // Surface the various error codes from /api/settings/team/accept.
    const errorCode = params.get('error')
    useEffect(() => {
        if (!errorCode) return
        const messages: Record<string, string> = {
            'missing-token': 'That invite link is missing a token.',
            'invalid-invite': 'This invite link is invalid.',
            'invite-used': 'This invite has already been accepted.',
            'invite-expired': 'This invite has expired. Ask for a new one.',
            'email-mismatch': `You're signed in with a different email. Sign out and sign back in with ${
                params.get('expected') ?? 'the invited address'
            }.`,
        }
        toast.error(messages[errorCode] ?? 'Something went wrong with the invite.')
    }, [errorCode, params])

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<SignInFormData>({
        defaultValues: { email: prefilledEmail, password: '' },
        mode: 'onBlur',
    });

    const onSubmit = async (data: SignInFormData) => {
        const result = await signInWithEmail(data);
        if (result.success) {
            router.push(next);
        } else {
            toast.error('Sign in failed', { description: result.error ?? 'Invalid email or password.' });
        }
    }

    return (
        <>
            <h1 className="text-2xl font-semibold mb-6">Welcome back</h1>

            <div className="space-y-5">
                <GoogleSignInButton next={next} />

                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border" />
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                    <InputField
                        name="email"
                        label="Email"
                        placeholder="contact@jsmastery.com"
                        register={register}
                        error={errors.email}
                        validation={{ required: 'Email is required', pattern: /^\w+@\w+\.\w+$/ }}
                    />

                    <InputField
                        name="password"
                        label="Password"
                        placeholder="Enter your password"
                        type="password"
                        register={register}
                        error={errors.password}
                        validation={{ required: 'Password is required', minLength: 8 }}
                    />

                    <Button type="submit" disabled={isSubmitting} variant="default" className="w-full mt-5">
                        {isSubmitting ? 'Signing In' : 'Sign In'}
                    </Button>

                    <FooterLink text="Don't have an account?" linkText="Create an account" href="/sign-up" />
                </form>
            </div>
        </>
    );
};

const SignIn = () => (
    <Suspense fallback={null}>
        <SignInInner />
    </Suspense>
);

export default SignIn;
