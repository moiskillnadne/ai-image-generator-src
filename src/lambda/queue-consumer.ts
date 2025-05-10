import { SQSEvent, SQSHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log('Processing SQS messages:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      // Parse the message body
      const message = JSON.parse(record.body);
      console.log('Processing task:', message);
      
      const { bucket, key, userEmail, userId } = message;
      
      console.log(`Processing image from bucket: ${bucket}, key: ${key}`);
      
      // Get download link from s3 here

      const downloadUrl = await generatePresignedUrl(bucket, key);
      console.log(`Generated presigned URL: ${downloadUrl}`);

      await sendCompletionEmail(userEmail, key, downloadUrl);
      
      console.log(`Successfully processed task for user ${userId}, file: ${key}`);
    } catch (error) {
      console.error('Error processing SQS message:', error);
      throw error;
    }
  }
};

async function generatePresignedUrl(bucket: string, key: string, expiresIn: number = 604800): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  try {
    const url = await getSignedUrl(s3, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw new Error('Failed to generate download link');
  }
}

async function sendCompletionEmail(email: string, imageKey: string, downloadUrl: string): Promise<void> {
  const emailCommand = new SendEmailCommand({
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: 'Your AI Image Is Ready',
      },
      Body: {
        Text: {
          Data: `Your image processing is complete!
          
Image: ${imageKey}
Download Link: ${downloadUrl}

This download link will expire in 7 days.

Thank you for using our service.`,
        },
        Html: {
          Data: `
          <h2>Your AI Image Is Ready!</h2>
          <p>Your image processing is complete!</p>
          <p><strong>Image:</strong> ${imageKey}</p>
          <p><a href="${downloadUrl}" target="_blank">Download your image</a> (link expires in 7 days)</p>
          <p>Thank you for using our service.</p>
          `
        }
      },
    },
    Source: process.env.SENDER_EMAIL!,
  });

  try {
    await ses.send(emailCommand);
    console.log(`Completion email sent to ${email}`);
  } catch (error) {
    console.error('Error sending completion email:', error);
    throw new Error('Failed to send completion email');
  }
}