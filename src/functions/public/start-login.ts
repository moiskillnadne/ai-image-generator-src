// src/functions/public/start-login.ts
import { 
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.CLIENT_ID!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;

    console.log('[StartLogin] Received email:', email);

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Email is required' }),
      };
    }

    let userExists = true;

    try {
      console.log('[StartLogin] Checking if user exists in Cognito');
      await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      }));
    } catch (err: any) {
      if (err.name === 'UserNotFoundException') {
        userExists = false;
        console.log('[StartLogin] User does not exist, have to create a new user');
      } else {
        throw err;
      }
    }

    if (!userExists) {
      console.log('[StartLogin] Creating new user in Cognito');
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }));
    }

    console.log('[StartLogin] Initiating custom auth flow');
    const response = await cognito.send(new AdminInitiateAuthCommand({
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: CLIENT_ID,
      UserPoolId: USER_POOL_ID,
      AuthParameters: { USERNAME: email },
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'OTP code sent to your email', session: response.Session }),
    };
  } catch (error: any) {
    console.error('[StartLogin] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to start login', error: error.message }),
    };
  }
};
