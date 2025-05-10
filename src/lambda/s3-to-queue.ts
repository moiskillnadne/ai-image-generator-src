import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  console.log('S3 event:', JSON.stringify(event, null, 2));

  const records = event.Records || [];

  for (const record of records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;
    const userId = key.split('/')[1];

    const user = await dynamo.send(new GetItemCommand({
      TableName: process.env.USER_TABLE_NAME!,
      Key: {
        pk: { S: `user#${userId}` },
      },
    }));

    const userEmail = user.Item?.email?.S;

    console.log('User email:', userEmail);

    if (!userEmail) {
      console.error('User not found or email not available:', userId);
      throw new Error('User not found or email not available');
    }

    const payload = {
      bucket,
      key,
      size,
      userId,
      userEmail,
      uploadedAt: new Date().toISOString(),
    };

    const command = new SendMessageCommand({
      QueueUrl: process.env.QUEUE_URL!,
      MessageBody: JSON.stringify(payload),
    });

    try {
      await sqs.send(command);
      console.log('Enqueued:', payload);
    } catch(error) {
      console.error('Error sending message to SQS:', error);
      throw new Error('Failed to send message to SQS');
    }

    const emailCommand = new SendEmailCommand({
      Destination: {
        ToAddresses: [process.env.NOTIFY_EMAIL!],
      },
      Message: {
        Subject: {
          Data: 'New S3 Upload',
        },
        Body: {
          Text: {
            Data: `File uploaded:\nBucket: ${bucket}\nKey: ${key}\nSize: ${size} bytes`,
          },
        },
      },
      Source: process.env.SENDER_EMAIL!,
    });
    
    try {
      await ses.send(emailCommand);
      console.log('Notification email sent.');
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send notification email');
    }
  }

  return { status: 'done' };
};