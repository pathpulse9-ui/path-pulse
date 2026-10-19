#!/usr/bin/env python3
"""Point an App Runner service at a new image and/or merge env vars into it.

Fetches the service's current SourceConfiguration, changes only what is asked,
and calls update-service. Existing env vars are preserved; --env-file entries
matching --allow are merged on top. Keys named in --secret-keys never stay in
plaintext RuntimeEnvironmentVariables: their values are written to Secrets
Manager under pathpulse/<service>/<KEY> and referenced from
RuntimeEnvironmentSecrets. No value is ever printed.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def aws(*args: str) -> str:
    return subprocess.check_output(["aws", *args]).decode()


def private_file(text: str) -> str:
    fd, path = tempfile.mkstemp(prefix="apprunner-")
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    return path


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


def put_secret(region: str, name: str, value: str) -> str:
    path = private_file(value)
    try:
        try:
            return aws("secretsmanager", "put-secret-value", "--region", region, "--secret-id", name,
                       "--secret-string", f"file://{path}", "--query", "ARN", "--output", "text").strip()
        except subprocess.CalledProcessError:
            return aws("secretsmanager", "create-secret", "--region", region, "--name", name,
                       "--tags", "Key=Project,Value=pathpulse",
                       "--secret-string", f"file://{path}", "--query", "ARN", "--output", "text").strip()
    finally:
        os.remove(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--arn", required=True)
    ap.add_argument("--image", help="new ImageIdentifier")
    ap.add_argument("--env-file")
    ap.add_argument("--allow", default="", help="space-separated env key allowlist")
    ap.add_argument("--unset", default="", help="space-separated env keys to remove")
    ap.add_argument("--secret-keys", default="", help="space-separated keys kept in Secrets Manager")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    service = args.arn.split("service/")[1].split("/")[0]
    secret_keys = set(args.secret_keys.split())

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
    secrets = dict(conf.get("RuntimeEnvironmentSecrets", {}))

    if args.env_file and args.allow:
        add = load_env(args.env_file, set(args.allow.split()))
        kept = sorted(set(env) - set(add))
        print(f"env merge  : {', '.join(sorted(add)) or '(no keys matched allowlist)'}")
        print(f"env kept   : {len(kept)} existing var(s) untouched")
        env.update(add)
    for key in args.unset.split():
        if env.pop(key, None) is not None or secrets.pop(key, None) is not None:
            print(f"env unset  : {key}")

    to_move = sorted(k for k in env if k in secret_keys)
    for key in to_move:
        value = env.pop(key)
        if args.dry_run:
            print(f"secret     : {key} -> pathpulse/{service}/{key} (dry run, not written)")
            continue
        secrets[key] = put_secret(args.region, f"pathpulse/{service}/{key}", value)
        print(f"secret     : {key} -> Secrets Manager")

    conf["RuntimeEnvironmentVariables"] = env
    conf["RuntimeEnvironmentSecrets"] = secrets

    if args.dry_run:
        print(f"plaintext  : {', '.join(sorted(env))}")
        print(f"secrets    : {', '.join(sorted(set(secrets) | set(to_move)))}")
        return 0

    path = private_file(json.dumps(cfg))
    try:
        op = aws("apprunner", "update-service", "--region", args.region,
                 "--service-arn", args.arn, "--source-configuration", f"file://{path}",
                 "--query", "OperationId", "--output", "text").strip()
    finally:
        os.remove(path)
    print(f"deploy op  : {op}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
