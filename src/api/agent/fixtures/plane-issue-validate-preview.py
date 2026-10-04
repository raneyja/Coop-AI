# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
# Remote-source regression fixture only; never read for runtime repository intelligence.
# CoopAI-Corp/plane preview commit a8e53b6ac7b87bd8e3e931d21188f7679c7ab6c4
# apps/api/plane/api/serializers/issue.py, lines 75-149 (validate method).
    def validate(self, data):
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        try:
            if data.get("description_html", None) is not None:
                parsed = html.fromstring(data["description_html"])
                parsed_str = html.tostring(parsed, encoding="unicode")
                data["description_html"] = parsed_str

        except Exception:
            raise serializers.ValidationError("Invalid HTML passed")

        # Validate description content for security
        if data.get("description_html"):
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if data.get("description_binary"):
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        # Validate assignees are from project
        if data.get("assignees", []):
            data["assignees"] = ProjectMember.objects.filter(
                project_id=self.context.get("project_id"),
                is_active=True,
                role__gte=15,
                member_id__in=data["assignees"],
            ).values_list("member_id", flat=True)

        # Validate labels are from project
        if data.get("labels", []):
            data["labels"] = Label.objects.filter(
                project_id=self.context.get("project_id"), id__in=data["labels"]
            ).values_list("id", flat=True)

        # Check state is from the project only else raise validation error
        if (
            data.get("state")
            and not State.objects.filter(project_id=self.context.get("project_id"), pk=data.get("state").id).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")

        # Check parent issue is from workspace as it can be cross workspace
        if (
            data.get("parent")
            and not Issue.objects.filter(
                workspace_id=self.context.get("workspace_id"),
                project_id=self.context.get("project_id"),
                pk=data.get("parent").id,
            ).exists()
        ):
            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")

        if (
            data.get("estimate_point")
            and not EstimatePoint.objects.filter(
                workspace_id=self.context.get("workspace_id"),
                project_id=self.context.get("project_id"),
                pk=data.get("estimate_point").id,
            ).exists()
        ):
            raise serializers.ValidationError("Estimate point is not valid please pass a valid estimate_point_id")

        return data
