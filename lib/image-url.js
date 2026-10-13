// Where an uploaded picture lives. Sent emails point at these addresses forever, so the key is unique
// per upload and never reused or changed.

// "images/photo.png" + "a1b2c3" -> "images/photo-a1b2c3.png"
export function buildImageKey(pathname, suffix) {
	const dot = pathname.lastIndexOf(".");
	return dot > pathname.lastIndexOf("/") ? `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}` : `${pathname}-${suffix}`;
}

// S3_PUBLIC_URL is for a CDN or custom domain in front of the bucket; without it the bucket's own address is used.
export function getImageUrl({ bucket, region, publicUrl, key }) {
	const base = publicUrl?.trim().replace(/\/+$/, "") || `https://${bucket}.s3.${region}.amazonaws.com`;
	return `${base}/${key}`;
}
