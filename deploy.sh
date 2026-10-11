#!/usr/bin/env bash
# One-command deploy: Firestore + Cloud Run feedback API + Firebase Hosting (visitor app).
# First time only:  gcloud auth login   (and the project needs billing enabled for Cloud Run)
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=$(python3 -c 'import json; print(json.load(open(".firebaserc"))["projects"]["lantern"])')
REGION=asia-south1   # Mumbai: closest to the venues
echo "Deploying Lantern to project $PROJECT ($REGION)"

gcloud config set project "$PROJECT" --quiet
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com --quiet

# Firestore database (once)
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 \
  || gcloud firestore databases create --location="$REGION" --quiet

# Newer projects don't auto-grant roles: let the default service account build images and use Firestore.
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="$NUM-compute@developer.gserviceaccount.com"
for ROLE in roles/datastore.user roles/cloudbuild.builds.builder roles/logging.logWriter roles/storage.objectViewer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

# Cloud Run API (built from source with Google's buildpacks; capped at 2 instances to keep costs ~zero)
gcloud run deploy lantern-api --source api --region "$REGION" --allow-unauthenticated \
  --max-instances 2 --memory 256Mi --quiet

# Visitor app + /api rewrite + Firestore rules
firebase deploy --only hosting,firestore:rules --project "$PROJECT"

echo
echo "Done. App: https://$PROJECT.web.app   API check: https://$PROJECT.web.app/api/health"
