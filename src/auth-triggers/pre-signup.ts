// src/auth-triggers/pre-signup/handler.ts
export const handler = async (event: any) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};

