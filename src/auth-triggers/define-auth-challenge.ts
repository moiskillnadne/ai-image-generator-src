// src/auth-triggers/define-auth-challenge/handler.ts

export const handler = async (event: any) => {
  const session = event.request.session || [];

  if (session.length === 0) {
    // First auth attempt — ask for custom challenge
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
  } else {
    const lastChallenge = session[session.length - 1];

    if (lastChallenge.challengeName === 'CUSTOM_CHALLENGE' && lastChallenge.challengeResult === true) {
      // Code was correct
      event.response.issueTokens = true;
      event.response.failAuthentication = false;
    } else if (session.length >= 3) {
      // Too many failed attempts
      event.response.issueTokens = false;
      event.response.failAuthentication = true;
    } else {
      // Retry challenge
      event.response.issueTokens = false;
      event.response.failAuthentication = false;
      event.response.challengeName = 'CUSTOM_CHALLENGE';
    }
  }

  return event;
};
