#!/usr/bin/env python3
"""Point an App Runner service at a new image and/or merge env vars into it.

Fetches the service's current SourceConfiguration, changes only what is asked,
and calls update-service. Existing env vars are preserved; --env-file entries
matching --allow are merged on top.
"""
import argparse
import json
import subprocess
import sys


def aws(*args: str) -> str:
    return subprocess.check_output(["aws", *args]).decode()


def load_env(path: str, allow: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in allow and val:
                out[key] = val
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--arn", required=True)
    ap.add_argument("--image", help="new ImageIdentifier")
    ap.add_argument("--env-file")
    ap.add_argument("--allow", default="", help="space-separated env key allowlist")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads(
        aws("apprunner", "describe-service", "--region", args.region,
            "--service-arn", args.arn, "--query", "Service.SourceConfiguration",
            "--output", "json")
    )
    repo = cfg["ImageRepository"]

    if args.image:
        print(f"image: {repo['ImageIdentifier']} -> {args.image}")
        repo["ImageIdentifier"] = args.image

    conf = repo.setdefault("ImageConfiguration", {})
    env = dict(conf.get("RuntimeEnvironmentVariables", {}))

    if args.env_file and args.allow:
        add = load_env(args.env_file, set(args.allow.split()))
        kept = sorted(set(env) - set(add))
        print(f"env merge  : {', '.join(sorted(add)) or '(no keys matched allowlist)'}")
        print(f"env kept   : {len(kept)} existing var(s) untouched")
        env.update(add)
    conf["RuntimeEnvironmentVariables"] = env

    if args.dry_run:
        print(json.dumps(cfg, indent=2))
        return 0

    tmp = "/tmp/apprunner-src.json"
    with open(tmp, "w") as fh:
        json.dump(cfg, fh)
    op = aws("apprunner", "update-service", "--region", args.region,
             "--service-arn", args.arn, "--source-configuration", f"file://{tmp}",
             "--query", "OperationId", "--output", "text").strip()
    print(f"deploy op  : {op}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
