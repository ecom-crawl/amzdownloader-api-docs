"""Standard-library client. Credentials are restricted to the fixed API origin."""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API_BASE = "https://amzdownloader.com/api/v1"
JOB_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

class ApiError(RuntimeError):
    def __init__(self, status, code, retry_after=None):
        self.status, self.code, self.retry_after = status, code, retry_after
        suffix = f"; retry after {retry_after} seconds" if retry_after else ""
        super().__init__(f"AmzDownloader HTTP {status} ({code}){suffix}")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ApiError(code, "redirect_rejected")

def job_path(job_id, suffix=""):
    if not JOB_ID.fullmatch(str(job_id)) or suffix not in ("", "/result"):
        raise ValueError("Invalid job ID")
    return "/scrapes/" + job_id + suffix

def media_path(asin, marketplace="amazon.com"):
    if not re.fullmatch(r"[A-Za-z0-9]{10}", asin):
        raise ValueError("ASIN must contain 10 letters or digits")
    return "/products/" + asin.upper() + "/media?" + urllib.parse.urlencode({"marketplace": marketplace})

def allowed_path(path):
    parsed = urllib.parse.urlsplit(path)
    return (path.startswith("/") and not path.startswith("//") and not parsed.netloc and not parsed.scheme and not parsed.fragment
            and re.fullmatch(r"/(usage|health|capabilities|openapi\.json|scrapes(/[0-9a-fA-F-]{36}(/result)?)?|products/[A-Z0-9]{10}/media|videos/convert)", parsed.path))

class Client:
    def __init__(self, key=None, opener=None):
        self.key = key if key is not None else os.environ.get("AMZDOWNLOADER_API_KEY", "")
        if not self.key.strip() or "\r" in self.key or "\n" in self.key:
            raise ValueError("Set AMZDOWNLOADER_API_KEY in your environment")
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def request(self, method, path, body=None, idempotency_key=None):
        if not allowed_path(path) or method not in ("GET", "POST"):
            raise ValueError("Unsupported API request path or method")
        if idempotency_key and not re.fullmatch(r"[!-~]{1,128}", idempotency_key):
            raise ValueError("Invalid idempotency key")
        headers = {"Authorization": "Bearer " + self.key, "Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(API_BASE + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=60) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            try:
                value = json.loads(error.read())
                code = value.get("error", {}).get("code", "request_failed")
                if not isinstance(code, str) or not re.fullmatch(r"[a-zA-Z0-9_]{1,80}", code):
                    code = "request_failed"
            except (ValueError, AttributeError, TypeError):
                code = "request_failed"
            retry_value = error.headers.get("Retry-After", "") if error.headers else ""
            retry_after = int(retry_value) if re.fullmatch(r"[0-9]{1,5}", retry_value) else None
            raise ApiError(error.code, code, retry_after) from None
        except urllib.error.URLError:
            raise RuntimeError("API connection failed; reuse the original idempotency key when retrying") from None

    def extract(self, url, idempotency_key=None, max_polls=20, wait=time.sleep):
        if not isinstance(max_polls, int) or not 1 <= max_polls <= 100:
            raise ValueError("Use a finite polling budget between 1 and 100")
        status, result = self.request("POST", "/scrapes", {"url": url, "renderMode": "auto"}, idempotency_key or str(uuid.uuid4()))
        if status == 200 and result.get("status") == "completed":
            return result
        if status != 202 or not result.get("jobId"):
            raise RuntimeError("Unexpected extraction response")
        job_id = result["jobId"]
        path = job_path(job_id)
        for _ in range(max_polls):
            wait(3)
            _, job = self.request("GET", path)
            if job.get("status") == "completed":
                return self.request("GET", job_path(job_id, "/result"))[1]
            if job.get("status") in ("failed", "expired"):
                raise RuntimeError(f"Extraction {job['status']}; job {job_id}")
            if job.get("status") not in ("queued", "processing"):
                raise RuntimeError(f"Unexpected job status; job {job_id}")
        raise RuntimeError(f"Polling budget exhausted; job {job_id} may still be running. Check it later without submitting another extraction.")
