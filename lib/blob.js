import "server-only";
import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";
import { buildImageKey, getImageUrl } from "@/lib/image-url";

// Sent emails point at these files forever, so their URLs never change and browsers can cache them for a year.
const ONE_YEAR = 365 * 24 * 60 * 60;

const S3_REGION = process.env.S3_REGION || process.env.SES_REGION || "us-east-1";
let s3;

// Pictures go to an S3 bucket when S3_BUCKET is set (works on any host), or to Vercel Blob when its token is.
export function isImageStorageConfigured() {
	return Boolean(process.env.S3_BUCKET || process.env.BLOB_READ_WRITE_TOKEN);
}

// Same IAM keys as SES: the user's policy also allows s3:PutObject on the bucket's images/ folder.
function getS3() {
	const { SES_ACCESS_KEY_ID: accessKeyId, SES_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
	s3 ??= new S3Client({
		region: S3_REGION,
		credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
	});
	return s3;
}

async function putS3(pathname, bytes, contentType) {
	const key = buildImageKey(pathname, crypto.randomBytes(6).toString("hex"));
	await getS3().send(
		new PutObjectCommand({
			Bucket: process.env.S3_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: contentType,
			CacheControl: `public, max-age=${ONE_YEAR}, immutable`,
		})
	);
	return getImageUrl({
		bucket: process.env.S3_BUCKET,
		region: S3_REGION,
		publicUrl: process.env.S3_PUBLIC_URL,
		key,
	});
}

export async function putImage(pathname, bytes, contentType) {
	if (process.env.S3_BUCKET) return putS3(pathname, bytes, contentType);

	const blob = await put(pathname, bytes, {
		access: "public",
		contentType,
		addRandomSuffix: true,
		cacheControlMaxAge: ONE_YEAR,
	});
	return blob.url;
}
