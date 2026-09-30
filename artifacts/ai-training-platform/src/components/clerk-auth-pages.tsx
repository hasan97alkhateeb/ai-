import { useEffect, useRef } from 'react';
import { SignIn, SignUp, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { shadcn } from '@clerk/themes';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const logoImageUrl = `${window.location.origin}${basePath}/logo.svg`;

export const academyAuthAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl,
  },
  variables: {
    colorPrimary: '#2b5b74',
    colorForeground: '#24313b',
    colorMutedForeground: '#65717e',
    colorDanger: '#bb5149',
    colorBackground: '#fbfaf8',
    colorInput: '#f7f4ee',
    colorInputForeground: '#24313b',
    colorNeutral: '#dcd6cd',
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: '0.875rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox:
      'bg-[#fbfaf8] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#ded8cf]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#24313b] font-semibold',
    headerSubtitle: 'text-[#65717e]',
    socialButtonsBlockButtonText: '!text-[#24313b] font-medium',
    formFieldLabel: 'text-[#34434e] font-medium',
    footerActionLink: 'text-[#2b5b74] font-semibold',
    footerActionText: 'text-[#65717e]',
    dividerText: 'text-[#65717e]',
    identityPreviewEditButton: 'text-[#2b5b74]',
    formFieldSuccessText: 'text-[#3f744a]',
    alertText: 'text-[#8f3731]',
    logoBox: 'rounded-lg',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border-[#dcd6cd] bg-white',
    formButtonPrimary: '!bg-[#2b5b74] !text-white hover:!bg-[#21495f] font-semibold',
    formFieldInput: 'border-[#dcd6cd] bg-[#f7f4ee] text-[#24313b]',
    footerAction: 'border-t border-[#e6e0d7]',
    dividerLine: 'bg-[#dcd6cd]',
    alert: 'border-[#e6c5c1] bg-[#fff5f3]',
    otpCodeFieldInput: 'border-[#dcd6cd] bg-[#f7f4ee] text-[#24313b]',
    formFieldRow: 'gap-1.5',
    main: 'text-[#24313b]',
  },
};

export function SignInPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <SignIn
        appearance={academyAuthAppearance}
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/practice`}
      />
    </main>
  );
}

export function SignUpPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <SignUp
        appearance={academyAuthAppearance}
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/practice`}
      />
    </main>
  );
}

export function ClerkAuthQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      ) {
        // Learner-scoped data must not remain visible after an account switch.
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}