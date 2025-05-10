// src/functions/public/confirm-login.ts
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const cognito = new CognitoIdentityProviderClient({});
const dynamo = new DynamoDBClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.CLIENT_ID!;
const USER_TABLE_NAME = process.env.USER_TABLE_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, code, session } = body;

    if (!email || !code || !session) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Email, code, and session are required' }),
      };
    }

    const challengeResponse = await cognito.send(new RespondToAuthChallengeCommand({
      ChallengeName: 'CUSTOM_CHALLENGE',
      ClientId: CLIENT_ID,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: code,
      },
      Session: session,
    }));

    if (!challengeResponse.AuthenticationResult) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Invalid or expired OTP' }),
      };
    }

    const userData = await cognito.send(new AdminGetUserCommand({
      Username: email,
      UserPoolId: USER_POOL_ID,
    }));

    const userId = userData.UserAttributes?.find(attr => attr.Name === 'sub')?.Value;

    if (!userId) {
      throw new Error('Unable to retrieve user ID (sub) from Cognito');
    }

    await dynamo.send(new PutItemCommand({
      TableName: USER_TABLE_NAME,
      Item: {
        pk: { S: `user#${userId}` },
        email: { S: email },
        createdAt: { S: new Date().toISOString() },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        accessToken: challengeResponse.AuthenticationResult.AccessToken,
        idToken: challengeResponse.AuthenticationResult.IdToken,
        refreshToken: challengeResponse.AuthenticationResult.RefreshToken,
      }),
    };
  } catch (error: any) {
    console.error('[ConfirmLogin] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to confirm login', error: error.message }),
    };
  }
};