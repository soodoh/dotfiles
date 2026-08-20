#!/usr/bin/env fish

set -l repository_root (path resolve (path dirname (status filename))/../..)
source "$repository_root/dotfiles/common/fish/custom/functions/gbclone.fish"

set -l projects_dir "$HOME/Projects"
mkdir -p "$projects_dir"; or exit 1
cd "$projects_dir"; or exit 1

set -l repositories \
  "1ds-app|git@github.docusignhq.com:Core/1ds-app.git" \
  "1ds-docs|git@github.docusignhq.com:Core/1ds-docs.git" \
  "1ds-qe|git@github.docusignhq.com:Core/1ds-qe.git" \
  "1ds|git@github.docusignhq.com:Core/1ds.git" \
  "account-discovery-infra|git@github.docusignhq.com:Microservices/account-discovery-infra.git" \
  "account-discovery-widget|git@github.docusignhq.com:Core/account-discovery-widget.git" \
  "components|git@github.docusignhq.com:FrontEndShared/components.git" \
  "ds-devtools|git@github.docusignhq.com:FrontEndShared/ds-devtools.git" \
  "ds-icons|git@github.docusignhq.com:front-end-systems/ds-icons.git" \
  "ds-ui|git@github.docusignhq.com:front-end-systems/ds-ui.git" \
  "FeaturePaywalls|git@github.docusignhq.com:Core/FeaturePaywalls.git" \
  "in-product-communication|git@github.docusignhq.com:Core/in-product-communication.git" \
  "InProductCommunicationAdmin|git@github.docusignhq.com:Core/InProductCommunicationAdmin.git" \
  "InviteYourTeam|git@github.docusignhq.com:Core/InviteYourTeam.git" \
  "ipg-engagements|git@github.docusignhq.com:Microservices/ipg-engagements.git" \
  "ipg-engagements/infra|git@github.docusignhq.com:Microservices/ipg-engagements-infra.git" \
  "ipg-shared|git@github.docusignhq.com:Core/ipg-shared.git" \
  "kusto|git@github.docusignhq.com:Core/kusto.git" \
  "martini-app|git@github.docusignhq.com:martini/app.git" \
  "martini-server|git@github.docusignhq.com:Microservices/martini-server.git" \
  "msf-dev|https://github.docusignhq.com/Microservices/msf-dev" \
  "msf-routing-service|https://github.docusignhq.com/Microservices/msf-routing-service.git" \
  "olive-images|git@github.docusignhq.com:olive/images.git" \
  "Onboarding|git@github.docusignhq.com:Core/Onboarding.git" \
  "OnboardingChecklist|git@github.docusignhq.com:Core/OnboardingChecklist.git" \
  "OneAdmin|git@github.docusignhq.com:Paul-DiLoreto/OneAdmin.git" \
  "prepare|git@github.docusignhq.com:martini/prepare.git" \
  "Radmin|git@github.docusignhq.com:Core/Radmin.git" \
  "SAW|git@github.docusignhq.com:QA/SAW.git" \
  "setting-service|git@github.docusignhq.com:Microservices/setting-service.git" \
  "signing-app|git@github.docusignhq.com:signing-team/app.git" \
  "Walkthrough|git@github.docusignhq.com:Core/Walkthrough.git" \
  "widget-starter-kit|git@github.docusignhq.com:Core/widget-starter-kit.git"

for repository in $repositories
  set -l fields (string split -m 1 '|' -- "$repository")
  gbclone $fields[2] $fields[1]; or exit 1
end
