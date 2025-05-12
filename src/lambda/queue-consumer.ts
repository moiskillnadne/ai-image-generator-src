import { Readable } from 'stream'
import { SQSEvent, SQSHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import OpenAI from 'openai';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });
const secrets = new SecretsManagerClient({});

export const humanVersionOfPetPromt = `
Transform this animal into a female human character, removing all animal features (such as fur, ears, whiskers, muzzle, tail, etc.) while preserving its personality and recognizable traits. 
Focus on capturing the eye color, expression, posture, emotional vibe, and visual identity (like color scheme or accessories). 
The result should feel like a believable human version of this specific character. Realistic style.

Here is detailed description of pet:
`

export const detailedObjectPrompt = `
You are an expert pet describer. Given an image or basic description of a pet, your task is to produce a vivid, human-friendly portrayal that leaves no detail out. Cover every visible feature, from coat and color to anatomy and personality. Structure your output as either a descriptive paragraph or a clearly labeled list, including:

1. **Pet Identity**  
   - Species, breed (if known), age estimate, size.

2. **Coat & Coloration**  
   - Fur length and texture (e.g. silky, curly, dense).  
   - Primary coat color(s) and patterns (spots, stripes, gradients, patches).  
   - Eye color and any unique markings around eyes, muzzle, or ears.

3. **Facial Features & Expression**  
   - Shape of eyes, ears, nose, mouth.  
   - Expression or mood (happy, curious, relaxed, alert).

4. **Body & Posture**  
   - Build (slender, stocky), posture (standing, sitting, lying).  
   - Tail shape and position, paw details (size, claws, pads).

5. **Distinctive Marks & Accessories**  
   - Scars, whisker length, tattoos or tags, collars/harnesses.

6. **Personality & Behavior Clues**  
   - Any inferred traits (playful, shy, affectionate), pose or movement hints.

Bring all these elements together into a seamless, engaging description that feels like a person telling you about their beloved pet.  
`;


export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log('Processing SQS messages:', JSON.stringify(event, null, 2));

  const API_KEY = await getOpenAIKey();
  console.log('API_KEY:', API_KEY);

  const openAI = new OpenAI({ apiKey: API_KEY });
  
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log('Processing task:', message);
      
      const { bucket, key, userEmail, userId } = message;

      const get = new GetObjectCommand({ Bucket: bucket, Key: key });

      const response = await s3.send(get);

      if (!response.Body || !(response.Body instanceof Readable)) {
        throw new Error("Unexpected S3 Body type");
      }

       // download into memory
      const imageBuffer = await streamToBuffer(response.Body);
      console.log(`Downloaded ${imageBuffer.length} bytes from s3://${bucket}/${key}`);

      const imageFile = await OpenAI.toFile(imageBuffer, null, { type: 'image/png' })
      
      console.log(`Processing image from bucket: ${bucket}, key: ${key}`);

      const base64String = imageBuffer.toString('base64');

      const base64Uri = `data:image/jpeg;base64,${base64String}`

      console.log('Start Promting the GPT model to analyze the image and generate a detailed description');

      const textResponse = await openAI.responses.create({
        model: 'gpt-4.1',
        input: [
          {
            role: 'system',
            content: detailedObjectPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_image',
                detail: 'auto',
                image_url: base64Uri,
              },
            ],
          },
        ],
      });

      console.log('Text response from GPT:', textResponse);

      if(!textResponse.output_text) {
        throw new Error('No output text from GPT');
      }

      console.log('Start Processing image with OpenAI GPT-IMAGE-1 model');

      const imageResponse = await openAI.images.edit({
        model: 'gpt-image-1',
        quality: 'high',
        image: imageFile,
        prompt: `${humanVersionOfPetPromt} ${textResponse.output_text}`,
        n: 1,
      }).catch((error) => {
        console.error('Error processing image with OpenAI:', error);
        throw new Error('Failed to process image');
      })

      console.log('Image processing result:', imageResponse);

      const responseBase64Image = imageResponse.data?.[0]?.b64_json ?? null

      if(!responseBase64Image) {
        throw new Error('No image URL in response by OpenAI GPT-IMAGE-1');
      }

      console.log('Image processing completed successfully. The result image url:', responseBase64Image);


      // Upload the processed image back to S3

      const processedBuffer = Buffer.from(responseBase64Image, 'base64');

      console.log('Processed image buffer size:', processedBuffer.length);

      // Example of original key: 'uploads/c3244862-8051-701e-2c56-430511a84a2c/original-4d982b29-0451-40d9-bfab-bc7f74c0334a.png'
      const processedKey = `uploads/${userId}/processed-${key.split('/').pop()}`;

      console.log(`Uploading processed image to s3://${bucket}/${processedKey}`);

      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: processedKey,
        Body: processedBuffer,
        ContentType: "image/png",
        ACL: "private",
      });


      await s3.send(cmd);

      const EXPIRES_IN = 604800; // 7 days in seconds

      const downloadUrl = await generatePresignedUrl(bucket, processedKey, EXPIRES_IN);
      console.log(`Generated presigned URL: ${downloadUrl}`);

      await sendCompletionEmail(userEmail, processedKey, downloadUrl);
      
      console.log(`Successfully processed task for user ${userId}, file: ${key}`);
    } catch (error) {
      console.error('Error processing SQS message:', error);
      throw error;
    }
  }
};

async function getOpenAIKey(): Promise<string> {
  const resp = await secrets.send(
    new GetSecretValueCommand({ SecretId: process.env.OPENAI_SECRET_ARN! })
  );

  const secretKV = JSON.parse(resp.SecretString!);

  if(!secretKV.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not found in secret');
  }

  return secretKV.OPENAI_API_KEY;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

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
        Data: 'Your AI Image Is In Progress!',
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