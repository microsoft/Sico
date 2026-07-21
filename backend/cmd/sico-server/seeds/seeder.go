// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package seeds

import (
	"bytes"
	"context"
	"strconv"

	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/types"
	projectrepo "sico-backend/internal/store/project/repository"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
	projectdto "sico-backend/internal/transport/http/dto/project"

	"sico-backend/internal/di"
	"sico-backend/internal/embeddata"
)

const (
	projectDefaultIconName = "project-default.svg"

	iconContentType = "image/svg+xml"
	iconExt         = "svg"
	iconFileType    = "image"

	androidTesterSkillName        = "android-tester.zip"
	threeDArtistSkillName         = "ai-3d-model.zip"
	pmCompetitiveSkillName        = "pm-competitive-analysis.zip"
	pmSlidesSkillName             = "pm-frontend-slides.zip"
	pmOKRsSkillName               = "pm-setting-okrs-goals.zip"
	pmPRDsSkillName               = "pm-writing-prds.zip"
	marketingBrandSkillName       = "marketing-brand-storytelling.zip"
	marketingContentSkillName     = "marketing-content-marketing.zip"
	marketingImageSkillName       = "marketing-image-generation.zip"
	marketingLaunchSkillName      = "marketing-launch-marketing.zip"
	marketingPositioningSkillName = "marketing-positioning-messaging.zip"
	defaultSkillContentType       = "application/zip"
	defaultSkillExt               = "zip"
	defaultSkillFileType          = "archive"

	defaultProjectId = 1

	defaultOrganizationId   = 1
	defaultOrganizationName = "Default"
	defaultOrganizationDesc = "This is the default organization. " +
		"It is created by the system and contains all projects without specific organization assignment."

	defaultSystemUser   = "system@sico.local"
	defaultOperatorUser = "operator@sico.local"

	defaultOperatorAlias    = "Operator"
	defaultOperatorPassword = "operator"
	defaultOperatorEmail    = "operator@sico.local"
)

// embeddedFile satisfies multipart.File for byte-backed embedded assets.
type embeddedFile struct {
	*bytes.Reader
}

func (embeddedFile) Close() error { return nil }

type seedSkillFile struct {
	FileName string
	Content  []byte
}

func (s seedSkillFile) asReader() *bytes.Reader { return bytes.NewReader(s.Content) }

func (s seedSkillFile) asExtraInfo() types.FileExtraInfo {
	return types.FileExtraInfo{
		FileName:    s.FileName,
		ContentType: defaultSkillContentType,
		FileExt:     defaultSkillExt,
		FileType:    defaultSkillFileType,
	}
}

// ---------- Required Data ------------

func getDefaultProject(iconURI string) *projectrepo.ProjectModel {
	return &projectrepo.ProjectModel{
		ID:              defaultProjectId,
		OrganizationID:  defaultOrganizationId,
		OwnerUsername:   defaultSystemUser,
		Name:            "SICO",
		Description: "This is the default project that contains all assets without specific project assignment. " +
			"It is created by the system and cannot be deleted.",
		IconURI:         iconURI,
		CreatorUsername: defaultSystemUser,
	}
}

func getAgentSimpleChat(iconURI string) (*agententity.SingleAgent, *agententity.SingleAgentInstance) {
	agentId := "00000000-0000-0000-0000-000000000001"
	agent := &agententity.SingleAgent{
		SingleAgent: &agentdto.SingleAgent{
			AgentId:         agentId,
			CreatorUsername: defaultSystemUser,
			Name:            "Chat Agent",
			Role:            enum.AgentRoleAssistant.String(),
			Desc:            "This is the default chat agent that is created by the system.",
			IconUri:         iconURI,
			UpdaterUsername: defaultSystemUser,
		},
	}
	instance := &agententity.SingleAgentInstance{
		SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id:               1,
			AgentId:          agentId,
			EmployerUsername: defaultSystemUser,
			OperatorUsername: defaultOperatorUser,
			Name:             "Charlie",
			Role:             enum.AgentRoleAssistant.String(),
			Desc:             "This is the default chat agent instance that is created by the system.",
			IconUri:          iconURI,
			ProjectId:        defaultProjectId,
		},
	}
	return agent, instance
}

func getAgentAndroidTester(iconURI string) (*agententity.SingleAgent, *agententity.SingleAgentInstance) {
	agentId := "00000000-0000-0000-0000-000000000002"
	agent := &agententity.SingleAgent{
		SingleAgent: &agentdto.SingleAgent{
			AgentId:         agentId,
			CreatorUsername: defaultSystemUser,
			Name:            "Android Tester Agent",
			Role:            enum.AgentRoleAndroidTester.String(),
			Desc:            "This is an Android tester agent for testing purposes.",
			IconUri:         iconURI,
			UpdaterUsername: defaultSystemUser,
		},
	}
	instance := &agententity.SingleAgentInstance{
		SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id:               2,
			AgentId:          agentId,
			EmployerUsername: defaultSystemUser,
			OperatorUsername: defaultOperatorUser,
			Name:             "Max",
			Role:             enum.AgentRoleAndroidTester.String(),
			Desc:             "This is an Android tester agent instance for testing purposes.",
			IconUri:          iconURI,
			ProjectId:        defaultProjectId,
		},
	}
	return agent, instance
}

func getAgent3DArtist(iconURI string) (*agententity.SingleAgent, *agententity.SingleAgentInstance) {
	agentId := "00000000-0000-0000-0000-000000000003"
	agent := &agententity.SingleAgent{
		SingleAgent: &agentdto.SingleAgent{
			AgentId:         agentId,
			CreatorUsername: defaultSystemUser,
			Name:            "3D Artist Agent",
			Role:            enum.AgentRole3DArtist.String(),
			Desc:            "This is a 3D artist agent that can generate 3D models based on text or image prompts.",
			IconUri:         iconURI,
			UpdaterUsername: defaultSystemUser,
		},
	}
	instance := &agententity.SingleAgentInstance{
		SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id:               3,
			AgentId:          agentId,
			EmployerUsername: defaultSystemUser,
			OperatorUsername: defaultOperatorUser,
			Name:             "Luna",
			Role:             enum.AgentRole3DArtist.String(),
			Desc:             "This is a 3D artist agent instance",
			IconUri:          iconURI,
			ProjectId:        defaultProjectId,
		},
	}
	return agent, instance
}

func getAgentProductManager(iconURI string) (*agententity.SingleAgent, *agententity.SingleAgentInstance) {
	agentId := "00000000-0000-0000-0000-000000000004"
	agent := &agententity.SingleAgent{
		SingleAgent: &agentdto.SingleAgent{
			AgentId:         agentId,
			CreatorUsername: defaultSystemUser,
			Name:            "Product Manager Agent",
			Role:            enum.AgentRoleProductManager.String(),
			Desc: "This is a product manager agent that can help " +
				"manage product requirements, user stories, and backlogs.",
			IconUri:         iconURI,
			UpdaterUsername: defaultSystemUser,
		},
	}
	instance := &agententity.SingleAgentInstance{
		SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id:               4,
			AgentId:          agentId,
			EmployerUsername: defaultSystemUser,
			OperatorUsername: defaultOperatorUser,
			Name:             "Ethan",
			Role:             enum.AgentRoleProductManager.String(),
			Desc:             "This is a product manager agent instance",
			IconUri:          iconURI,
			ProjectId:        defaultProjectId,
		},
	}
	return agent, instance
}

func getAgentMarketing(iconURI string) (*agententity.SingleAgent, *agententity.SingleAgentInstance) {
	agentId := "00000000-0000-0000-0000-000000000005"
	agent := &agententity.SingleAgent{
		SingleAgent: &agentdto.SingleAgent{
			AgentId:         agentId,
			CreatorUsername: defaultSystemUser,
			Name:            "Marketing Agent",
			Role:            enum.AgentRoleMarketing.String(),
			Desc: "This is a marketing agent that can assist with " +
				"market research, content creation, and campaign management.",
			IconUri:         iconURI,
			UpdaterUsername: defaultSystemUser,
		},
	}
	instance := &agententity.SingleAgentInstance{
		SingleAgentInstance: &agentdto.SingleAgentInstance{
			Id:               5,
			AgentId:          agentId,
			EmployerUsername: defaultSystemUser,
			OperatorUsername: defaultOperatorUser,
			Name:             "Chloe",
			Role:             enum.AgentRoleMarketing.String(),
			Desc:             "This is a marketing agent instance",
			IconUri:          iconURI,
			ProjectId:        defaultProjectId,
		},
	}
	return agent, instance
}

// Run seeds default data required for the application to work out of the box.
func Run(ctx context.Context, injector *di.Injector) error {
	if err := checkDefaultOperatorUser(ctx, injector); err != nil {
		return err
	}

	// Upload default icons (idempotent) before the project/instance records
	// are created/updated so that their IconURI fields can reference them.
	projectIDStr := strconv.FormatInt(defaultProjectId, 10)
	_, projectIconURI, err := ensureAsset(ctx, injector, projectIDStr,
		embeddedFile{bytes.NewReader(embeddata.ProjectDefaultIcon)},
		types.FileExtraInfo{
			FileName:    projectDefaultIconName,
			ContentType: iconContentType,
			FileExt:     iconExt,
			FileType:    iconFileType,
		},
	)
	if err != nil {
		return err
	}

	if err := ensureOrganization(ctx, injector); err != nil {
		return err
	}

	if err := ensureProject(ctx, injector, getDefaultProject(projectIconURI)); err != nil {
		return err
	}

	if err := ensureProjectMembership(
		ctx, injector, defaultProjectId, defaultOperatorUser,
		int32(projectdto.MemberType_MEMBER_TYPE_MEMBER),
	); err != nil {
		return err
	}

	if err := ensureAgentAndroidTester(ctx, injector); err != nil {
		return err
	}
	if err := ensureAgent3DArtist(ctx, injector); err != nil {
		return err
	}
	if err := ensureAgentProductManager(ctx, injector); err != nil {
		return err
	}
	if err := ensureAgentMarketing(ctx, injector); err != nil {
		return err
	}

	return nil
}
