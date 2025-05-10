// src/functions/private/generate-upload-link.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import crypto from 'crypto';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const claims = (event.requestContext as any).authorizer?.claims;
    const userId = claims?.sub;

    console.log('[GenerateUploadLink] requestContext:', JSON.stringify(event.requestContext, null, 2));

    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }

    const fileId = crypto.randomUUID();
    const key = `uploads/${userId}/original-${fileId}.png`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: 'image/png',
    });

    const ONE_MINUTE = 60;

    const TEN_MINUTES = ONE_MINUTE * 10;

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: TEN_MINUTES });

    return {
      statusCode: 200,
      body: JSON.stringify({
        uploadUrl: signedUrl,
        fileKey: key
      })
    };
  } catch (err: any) {
    console.error('[GenerateUploadLink] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to generate upload link', error: err.message })
    };
  }
};
