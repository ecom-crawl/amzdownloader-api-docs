"""Run: python3 examples/python/download_images.py PRODUCT_URL OUTPUT_DIRECTORY."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request
from client import Client, NoRedirect, job_path

IMAGE_SELECTION = {
    "productImages": True, "variantImages": True,
    "productVideos": False, "relatedVideos": False, "creatorVideos": False,
}

def extract_images(client, url, operation_id, wait=time.sleep, max_polls=20):
    status, result = client.request("POST", "/scrapes", {
        "url": url, "renderMode": "auto", "include": IMAGE_SELECTION,
    }, operation_id)
    if status == 200 and result.get("status") == "completed":
        return result
    if status != 202:
        raise RuntimeError("Expected completed media or an extraction job")
    job_id = result.get("jobId")
    path = job_path(job_id, "/result")
    print("Save this job ID: " + job_id, file=sys.stderr)
    for _ in range(max_polls):
        wait(3)
        status, result = client.request("GET", path)
        if status == 200 and result.get("status") == "completed":
            return result
        if status != 202 or result.get("status") not in ("queued", "processing"):
            raise RuntimeError("Extraction stopped; inspect the saved job")
    raise RuntimeError("Polling limit reached; check saved job " + job_id)

def image_urls(media):
    values = list(media.get("productImages", []))
    for variant in media.get("variantImages", []):
        values.extend(variant.get("images", []))
    return list(dict.fromkeys(item["src"] for item in values if item.get("src")))

def download_image(url, directory, index, opener=None):
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower()
    allowed = any(host == domain or host.endswith("." + domain) for domain in (
        "media-amazon.com", "ssl-images-amazon.com", "images-amazon.com",
    ))
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or not allowed:
        raise ValueError("Refusing an image URL outside Amazon media hosts")
    # This request carries no AmzDownloader authorization header.
    opener = opener or urllib.request.build_opener(NoRedirect())
    with opener.open(urllib.request.Request(url), timeout=30) as response:
        suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(response.headers.get_content_type())
        if not suffix:
            raise ValueError("Unsupported image content type")
        data = response.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError("Image exceeds this example's 10 MB limit")
    target = directory / ("image-%03d" % index + suffix)
    with target.open("xb") as output:
        output.write(data)
    return target.name

def main():
    parser = argparse.ArgumentParser(description="Extract one product's images and download at most 20 unique source files")
    parser.add_argument("url")
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    operation_id = os.environ.get("AMZDOWNLOADER_IDEMPOTENCY_KEY")
    if not operation_id:
        parser.error("Set AMZDOWNLOADER_IDEMPOTENCY_KEY to a stable ID for this operation")
    result = extract_images(Client(), args.url, operation_id)
    args.output_directory.mkdir(parents=True, exist_ok=True)
    (args.output_directory / "media-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    data = result["data"]
    urls = image_urls(data["media"])
    saved = [download_image(url, args.output_directory, i + 1) for i, url in enumerate(urls[:20])]
    print(json.dumps({"asin": data["source"]["asin"], "availableImages": len(urls), "savedFiles": saved, "warnings": data["warnings"]}, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(str(error))
