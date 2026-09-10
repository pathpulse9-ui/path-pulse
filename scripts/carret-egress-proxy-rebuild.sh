#!/usr/bin/env bash
# Fix the Carret egress proxy: the first bootstrap failed (AL2023 has no `openssl`
# CLI, so `openssl passwd` aborted the user-data). This terminates the broken box
# and relaunches with a corrected bootstrap, reusing the SAME Elastic IP, security
# group, and proxy credentials (already in App Runner + .env — no redeploy needed).
#
# Run yourself: bash scripts/carret-egress-proxy-rebuild.sh
set -euo pipefail

REGION=${REGION:-us-east-1}
OLD_IID=${OLD_IID:-$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=pathpulse-carret-egress" "Name=instance-state-name,Values=running,stopped,pending" \
  --query 'Reservations[-1].Instances[-1].InstanceId' --output text)}
API_ARN="arn:aws:apprunner:$REGION:691650376162:service/pathpulse-demo-api/36dfb0f85c7a424f92726291399a79a9"

echo ">> broken instance: $OLD_IID"
read -r SG SUBNET < <(aws ec2 describe-instances --region "$REGION" --instance-ids "$OLD_IID" \
  --query 'Reservations[0].Instances[0].[SecurityGroups[0].GroupId,SubnetId]' --output text)
ALLOC=$(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=instance-id,Values=$OLD_IID" --query 'Addresses[0].AllocationId' --output text)
AMI=$(aws ssm get-parameter --region "$REGION" \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
echo ">> sg=$SG subnet=$SUBNET eip-alloc=$ALLOC ami=$AMI"

# reuse the exact user:pass:port already configured in App Runner
PROXY_URL=$(aws apprunner describe-service --region "$REGION" --service-arn "$API_ARN" \
  --query "Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.CARRET_HTTPS_PROXY" --output text)
rest=${PROXY_URL#http://}; PUSER=${rest%%:*}; rest=${rest#*:}
PPASS=${rest%@*}; hp=${rest#*@}; PPORT=${hp##*:}
echo ">> reusing user=$PUSER port=$PPORT"

UD=$(cat <<'USERDATA'
#!/bin/bash
exec > /var/log/carret-proxy-bootstrap.log 2>&1
set -x
dnf install -y squid httpd-tools
NCSA=$(rpm -ql squid | grep -m1 basic_ncsa_auth)
htpasswd -mbc /etc/squid/passwd '@@USER@@' '@@PASS@@'
chown root:squid /etc/squid/passwd
chmod 640 /etc/squid/passwd
cat > /etc/squid/squid.conf <<'CONF'
http_port @@PORT@@
auth_param basic program @@NCSA@@ /etc/squid/passwd
auth_param basic realm carret-egress
acl auth proxy_auth REQUIRED
acl carret dstdomain .carret.in
acl SSL_ports port 443
acl CONNECT method CONNECT
http_access deny CONNECT !SSL_ports
http_access deny !auth
http_access allow auth carret
http_access deny all
via off
forwarded_for delete
CONF
sed -i "s#@@NCSA@@#${NCSA}#" /etc/squid/squid.conf
squid -k parse
systemctl enable --now squid
systemctl is-active squid
USERDATA
)
UD=${UD//@@USER@@/$PUSER}
UD=${UD//@@PASS@@/$PPASS}
UD=${UD//@@PORT@@/$PPORT}

echo ">> terminating $OLD_IID"
aws ec2 terminate-instances --region "$REGION" --instance-ids "$OLD_IID" >/dev/null
aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$OLD_IID"

NEW=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" --instance-type t4g.nano \
  --subnet-id "$SUBNET" --security-group-ids "$SG" --metadata-options HttpTokens=required \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3,Encrypted=true}' \
  --user-data "$UD" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pathpulse-carret-egress},{Key=Project,Value=pathpulse}]' \
  --query 'Instances[0].InstanceId' --output text)
echo ">> new instance: $NEW — waiting running"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$NEW"
aws ec2 associate-address --region "$REGION" --instance-id "$NEW" --allocation-id "$ALLOC" >/dev/null
EIP=$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

echo ">> waiting ~75s for squid bootstrap..."
sleep 75
echo ">> test (should print $EIP):"
curl --max-time 20 -sx "http://${PUSER}:${PPASS}@${EIP}:${PPORT}" https://api.ipify.org \
  || echo "(not up — check: aws ec2 get-console-output --region $REGION --instance-id $NEW --latest | tail -40)"
echo
echo "========================================================"
echo "  New instance : $NEW"
echo "  Elastic IP   : $EIP   (unchanged — already in App Runner + Carret)"
echo "  Next         : curl https://demo-api.pathpulse.ai/v1/offramp/quotes?amount=10"
echo "========================================================"
