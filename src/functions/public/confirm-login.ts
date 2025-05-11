// src/functions/public/confirm-login.ts
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminRespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

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

    console.log(`[ConfirmLogin] Email: ${email}, Code: ${code}, Session: ${session}`);

    const challengeResponse = await cognito.send(new AdminRespondToAuthChallengeCommand({
      UserPoolId: USER_POOL_ID,
      ChallengeName: 'CUSTOM_CHALLENGE',
      ClientId: CLIENT_ID,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: code,
      },
      Session: session,
    }));

    console.log(`[ConfirmLogin] Challenge Response: ${JSON.stringify(challengeResponse)}`);

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

    console.log(`[ConfirmLogin] User ID: ${userId}`);

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
    })).catch((error) => {
      if (error.name !== 'ConditionalCheckFailedException') {
        console.error('[ConfirmLogin] Error saving user to DynamoDB:', error);
        throw error;
      }
      console.log('[ConfirmLogin] User already exists in DynamoDB, skipping save');
    })

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