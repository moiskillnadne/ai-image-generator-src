// src/auth-triggers/pre-signup/handler.ts
export const handler = async (event: any) => {
  // Auto-confirm the user and verify email
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};

