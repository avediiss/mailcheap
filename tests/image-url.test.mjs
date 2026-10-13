import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImageKey, getImageUrl } from "../lib/image-url.js";

test("the key keeps the folder and extension and adds the suffix before the extension", () => {
	assert.equal(buildImageKey("images/photo.png", "a1b2c3"), "images/photo-a1b2c3.png");
	assert.equal(buildImageKey("images/my.cat.gif", "ff00"), "images/my.cat-ff00.gif");
});

test("a name without an extension still gets the suffix", () => {
	assert.equal(buildImageKey("images/photo", "a1b2c3"), "images/photo-a1b2c3");
	assert.equal(buildImageKey("some.dir/photo", "a1b2c3"), "some.dir/photo-a1b2c3");
});

test("the URL is the bucket's own address unless a public URL is set", () => {
	const key = "images/photo-a1b2c3.png";
	assert.equal(
		getImageUrl({ bucket: "my-images", region: "eu-north-1", key }),
		"https://my-images.s3.eu-north-1.amazonaws.com/images/photo-a1b2c3.png"
	);
	assert.equal(
		getImageUrl({ bucket: "my-images", region: "eu-north-1", publicUrl: "https://img.example.com/", key }),
		"https://img.example.com/images/photo-a1b2c3.png"
	);
	assert.equal(
		getImageUrl({ bucket: "my-images", region: "eu-north-1", publicUrl: "  ", key }),
		"https://my-images.s3.eu-north-1.amazonaws.com/images/photo-a1b2c3.png"
	);
});
