// src/auth-triggers/verify-auth-challenge/handler.ts
export const handler = async (event: any) => {
  const expectedAnswer = event.request.privateChallengeParameters.secretCode;
  const userAnswer = event.request.challengeAnswer;

  event.response.answerCorrect = userAnswer === expectedAnswer;
  return event;
};