#!/usr/bin/env bash
# Create a single-purpose forward proxy with a fixed Elastic IP so the App Runner
# backend can reach dev.carret.in (Carret IP-blocks cloud egress).
#
# Creates: 1 security group, 1 t4g.nano (Amazon Linux 2023, squid), 1 Elastic IP.
# Cost: ~$3 t4g.nano + ~$3.60 public IPv4 + ~$0.80 EBS  ≈  $7.5/month.
#
# Run this yourself (needs ec2:RunInstances / AllocateAddress).
# Output: the Elastic IP + the CARRET_HTTPS_PROXY value for .env.
set -euo pipefail

REGION=${REGION:-us-east-1}
NAME=pathpulse-carret-egress
PROXY_PORT=8888
PROXY_USER=pathpulse
PROXY_PASS=${PROXY_PASS:-$(openssl rand -hex 16)}

echo ">> region=$REGION  proxy_user=$PROXY_USER"

AMI=$(aws ssm get-parameter --region "$REGION" \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query Parameter.Value --output text)
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
SUBNET=$(aws ec2 describe-subnets --region "$REGION" \
  --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)
echo ">> ami=$AMI vpc=$VPC subnet=$SUBNET"

SG=$(aws ec2 create-security-group --region "$REGION" --group-name "$NAME" \
  --description "PathPulse Carret egress proxy" --vpc-id "$VPC" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=pathpulse}]" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=$PROXY_PORT,ToPort=$PROXY_PORT,IpRanges=[{CidrIp=0.0.0.0/0,Description=squid-password-gated}]" >/dev/null
aws ec2 revoke-security-group-egress --region "$REGION" --group-id "$SG" \
  --ip-permissions "IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}]" >/dev/null 2>&1 || true
aws ec2 authorize-security-group-egress --region "$REGION" --group-id "$SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=53,ToPort=53,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=udp,FromPort=53,ToPort=53,IpRanges=[{CidrIp=0.0.0.0/0}]" >/dev/null
echo ">> sg=$SG (in 8888, out 443+53 only)"

USERDATA=$(cat <<EOF
#!/bin/bash
set -euxo pipefail
dnf install -y squid
NCSA=\$(rpm -ql squid | grep -m1 basic_ncsa_auth)
echo "${PROXY_USER}:\$(openssl passwd -apr1 '${PROXY_PASS}')" > /etc/squid/passwd
chown root:squid /etc/squid/passwd && chmod 640 /etc/squid/passwd
cat > /etc/squid/squid.conf <<CONF
http_port ${PROXY_PORT}
auth_param basic program \$NCSA /etc/squid/passwd
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
systemctl enable --now squid
EOF
)

IID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" \
  --instance-type t4g.nano --subnet-id "$SUBNET" --security-group-ids "$SG" \
  --metadata-options "HttpTokens=required" \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3,Encrypted=true}' \
  --user-data "$USERDATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=pathpulse}]" \
  --query 'Instances[0].InstanceId' --output text)
echo ">> instance=$IID  (waiting for running...)"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$IID"

ALLOC=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=pathpulse}]" \
  --query AllocationId --output text)
EIP=$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC" \
  --query 'Addresses[0].PublicIp' --output text)
aws ec2 associate-address --region "$REGION" --instance-id "$IID" --allocation-id "$ALLOC" >/dev/null
echo ">> eip=$EIP  (waiting ~60s for squid to come up...)"
sleep 75

echo ">> test — should print $EIP :"
curl --max-time 20 -sx "http://${PROXY_USER}:${PROXY_PASS}@${EIP}:${PROXY_PORT}" https://api.ipify.org || echo "(proxy not answering yet — check: aws ec2 get-console-output --region $REGION --instance-id $IID)"
echo

cat <<SUMMARY

========================================================================
  Elastic IP (send to Carret):   $EIP
  Instance:                       $IID
  Security group:                 $SG
  Allocation:                     $ALLOC

  Add to .env:
    CARRET_HTTPS_PROXY=http://${PROXY_USER}:${PROXY_PASS}@${EIP}:${PROXY_PORT}

  Then: make deploy-api
========================================================================
SUMMARY
