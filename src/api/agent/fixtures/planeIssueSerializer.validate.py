# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.utils import timezone
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer
from .state import StateLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueActivity,
    IssueComment,
    ProjectUserProperty,
    IssueAssignee,
    IssueSubscriber,
    IssueLabel,
    Label,
    CycleIssue,


















































class IssueCreateSerializer(BaseSerializer):
    # ids
    state_id = serializers.PrimaryKeyRelatedField(
        source="state", queryset=State.all_state_objects.all(), required=False, allow_null=True
    )
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent", queryset=Issue.objects.all(), required=False, allow_null=True
    )
    label_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )
    project_id = serializers.UUIDField(source="project.id", read_only=True)
    workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)

    class Meta:
        model = Issue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "completed_at",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        assignee_ids = self.initial_data.get("assignee_ids")
        data["assignee_ids"] = assignee_ids if assignee_ids else []
        label_ids = self.initial_data.get("label_ids")
        data["label_ids"] = label_ids if label_ids else []
        return data

    def validate(self, attrs):
        allow_triage = self.context.get("allow_triage_state", False)
        state_manager = State.triage_objects if allow_triage else State.objects

        if (
            attrs.get("start_date", None) is not None
            and attrs.get("target_date", None) is not None
            and attrs.get("start_date", None) > attrs.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        # Validate description content for security
        if "description_html" in attrs and attrs["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the attrs with sanitized HTML if available
            if sanitized_html is not None:
                attrs["description_html"] = sanitized_html

        if "description_binary" in attrs and attrs["description_binary"]:
            is_valid, error_msg = validate_binary_data(attrs["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        # Validate assignees are from project
        if attrs.get("assignee_ids", []):
            attrs["assignee_ids"] = ProjectMember.objects.filter(
                project_id=self.context["project_id"],
                role__gte=15,
                is_active=True,
                member_id__in=attrs["assignee_ids"],
            ).values_list("member_id", flat=True)

        # Validate labels are from project
        if attrs.get("label_ids"):
            label_ids = [label.id for label in attrs["label_ids"]]
            attrs["label_ids"] = list(
                Label.objects.filter(
                    project_id=self.context.get("project_id"),
                    id__in=label_ids,
                ).values_list("id", flat=True)
            )

        # Check state is from the project only else raise validation error
        if (
            attrs.get("state")
            and not state_manager.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("state").id,
            ).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")

        # Check parent issue is from workspace as it can be cross workspace
        if (
            attrs.get("parent")
            and not Issue.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("parent").id,
            ).exists()
        ):
            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")

        if (
            attrs.get("estimate_point")
            and not EstimatePoint.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("estimate_point").id,
            ).exists()
        ):
            raise serializers.ValidationError("Estimate point is not valid please pass a valid estimate_point_id")

        return attrs
