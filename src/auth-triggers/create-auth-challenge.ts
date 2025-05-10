// src/auth-triggers/create-auth-challenge/handler.ts
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient();
const FROM_EMAIL = process.env.FROM_EMAIL!;

export const handler = async (event: any) => {
  const email = event.request.userAttributes.email;

  const code = generateOTP();

  const params = new SendEmailCommand({
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Body: {
        Text: {
          Data: `Your login code is: ${code}`,
        },
      },
      Subject: { Data: "Your OTP Login Code" },
    },
    Source: FROM_EMAIL,
  });

  try {
    await ses.send(params);
    console.log(`OTP ${code} sent to ${email}`);
  } catch (err) {
    console.error("Failed to send email:", err);
  }

  event.response.publicChallengeParameters = { email };
  event.response.privateChallengeParameters = { secretCode: code };
  event.response.challengeMetadata = 'CODE_CHALLENGE';

  return event;
};

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}