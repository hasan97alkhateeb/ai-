declare global {
  interface Window {
    __PRACTICE_E2E_USER_ID__?: string;
  }
}

export function useAuth() {
  const userId = window.__PRACTICE_E2E_USER_ID__ ?? null;
  return {
    isLoaded: true,
    isSignedIn: Boolean(userId),
    userId,
  };
}

export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: Boolean(window.__PRACTICE_E2E_USER_ID__),
    user: {
      firstName: window.__PRACTICE_E2E_USER_ID__ ?? "Practice test learner",
      primaryEmailAddress: { emailAddress: "practice-test@example.invalid" },
    },
  };
}

export function useClerk() {
  return {
    signOut: async () => undefined,
    addListener: () => () => undefined,
  };
}

export function SignIn() {
  return null;
}

export function SignUp() {
  return null;
}