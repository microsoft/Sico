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

	"gorm.io/gorm"

	"sico-backend/internal/di"
	"sico-backend/internal/embeddata"
	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/shared/types"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	"sico-backend/pkg/logger"
)

func ensureAgent(ctx context.Context, injector *di.Injector, expected *agententity.SingleAgent) error {
	repo := agentrepo.NewSingleAgentRepo(injector.DB)

	existingAgent, err := repo.Get(ctx, expected.AgentId)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	if existingAgent == nil {
		return createOrRecoverAgent(ctx, injector, repo, expected)
	}

	// check if the agent needs to be updated
	if existingAgent.Name != expected.Name ||
		existingAgent.Role != expected.Role ||
		existingAgent.Desc != expected.Desc ||
		existingAgent.IconUri != expected.IconUri ||
		existingAgent.CreatorUsername != expected.CreatorUsername ||
		existingAgent.UpdaterUsername != expected.UpdaterUsername {
		if err = repo.Update(ctx, expected); err != nil {
			return err
		}
	}

	return nil
}

func createOrRecoverAgent(
	ctx context.Context,
	injector *di.Injector,
	repo agentrepo.SingleAgentRepository,
	expected *agententity.SingleAgent,
) error {
	err := repo.Create(ctx, expected.CreatorUsername, expected)
	if err == nil {
		return nil
	}
	if err != gorm.ErrDuplicatedKey {
		return err
	}

	logger.CtxWarn(ctx,
		"Agent %s already exists but is marked as deleted, trying to recover it",
		expected.AgentId)
	injector.DB.WithContext(ctx).Exec(
		"UPDATE t_single_agent SET deleted_at = null WHERE agent_id = ?", expected.AgentId)

	return repo.Update(ctx, expected)
}

func ensureAgentInstance(ctx context.Context, injector *di.Injector, expected *agententity.SingleAgentInstance) error {
	repo := agentrepo.NewSingleAgentInstanceRepo(injector.DB)

	existingInstance, err := repo.Get(ctx, expected.Id)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	if existingInstance == nil {
		return createOrRecoverAgentInstance(ctx, injector, repo, expected)
	}

	// check if the agent instance needs to be updated
	if existingInstance.AgentId != expected.AgentId ||
		existingInstance.EmployerUsername != expected.EmployerUsername ||
		existingInstance.OperatorUsername != expected.OperatorUsername ||
		existingInstance.Name != expected.Name ||
		existingInstance.Role != expected.Role ||
		existingInstance.Desc != expected.Desc ||
		existingInstance.IconUri != expected.IconUri ||
		existingInstance.ProjectId != expected.ProjectId {
		if err = repo.Update(ctx, expected); err != nil {
			return err
		}
	}

	return nil
}

func createOrRecoverAgentInstance(
	ctx context.Context,
	injector *di.Injector,
	repo agentrepo.SingleAgentInstanceRepository,
	expected *agententity.SingleAgentInstance,
) error {
	_, err := repo.Create(ctx, expected)
	if err == nil {
		return nil
	}
	if err != gorm.ErrDuplicatedKey {
		return err
	}

	logger.CtxWarn(ctx,
		"Agent instance %d already exists but is marked as deleted, trying to recover it",
		expected.Id)
	injector.DB.WithContext(ctx).Exec(
		"UPDATE t_single_agent_instance SET deleted_at = null WHERE id = ?", expected.Id)

	return repo.Update(ctx, expected)
}

func ensureAgentAndroidTester(ctx context.Context, injector *di.Injector) error {
	projectIDStr := strconv.FormatInt(defaultProjectId, 10)
	_, testerAgentIcon, err := ensureAsset(ctx, injector, projectIDStr,
		embeddedFile{bytes.NewReader(embeddata.AndroidTesterIcon)},
		types.FileExtraInfo{
			FileName:    "avatar-tester.svg",
			ContentType: iconContentType,
			FileExt:     iconExt,
			FileType:    iconFileType,
		},
	)
	if err != nil {
		return err
	}
	testerAgent, testerAgentInstance := getAgentAndroidTester(testerAgentIcon)
	if err := ensureAgent(ctx, injector, testerAgent); err != nil {
		return err
	}
	if err := ensureAgentInstance(ctx, injector, testerAgentInstance); err != nil {
		return err
	}

	// Register the default Android tester skills against the tester agent.
	androidTesterSkillBytes, err := embeddata.AndroidTesterSkillZip()
	if err != nil {
		return err
	}
	skills := []seedSkillFile{
		{FileName: androidTesterSkillName, Content: androidTesterSkillBytes},
	}
	if err := ensureSkill(ctx, injector, skills, testerAgent.AgentId); err != nil {
		return err
	}

	// Best-effort: bind a sandbox to the tester agent instance so it's ready for immediate use with the emulator.
	// Failures here must NOT block server startup — local dev
	// setups may run the backend without an emulator at all.
	if err := checkSandboxAssigned(ctx, testerAgentInstance.Id); err != nil {
		logger.CtxWarn(ctx, "checkDefaultSandboxAssignment failed (non-fatal): %v", err)
	}

	return nil
}

func ensureAgent3DArtist(ctx context.Context, injector *di.Injector) error {
	projectIDStr := strconv.FormatInt(defaultProjectId, 10)
	_, artistAgentIcon, err := ensureAsset(ctx, injector, projectIDStr,
		embeddedFile{bytes.NewReader(embeddata.ThreeDArtistIcon)},
		types.FileExtraInfo{
			FileName:    "avatar-3d-artist.svg",
			ContentType: iconContentType,
			FileExt:     iconExt,
			FileType:    iconFileType,
		},
	)
	if err != nil {
		return err
	}
	artistAgent, artistAgentInstance := getAgent3DArtist(artistAgentIcon)
	if err := ensureAgent(ctx, injector, artistAgent); err != nil {
		return err
	}
	if err := ensureAgentInstance(ctx, injector, artistAgentInstance); err != nil {
		return err
	}

	// Register the default 3D artist skill against the 3D artist agent.
	skills := []seedSkillFile{{FileName: threeDArtistSkillName, Content: embeddata.ThreeDArtistSkillZip}}
	if err := ensureSkill(ctx, injector, skills, artistAgent.AgentId); err != nil {
		return err
	}

	return nil
}

func ensureAgentProductManager(ctx context.Context, injector *di.Injector) error {
	projectIDStr := strconv.FormatInt(defaultProjectId, 10)
	_, pmAgentIcon, err := ensureAsset(ctx, injector, projectIDStr,
		embeddedFile{bytes.NewReader(embeddata.ProductManagerIcon)},
		types.FileExtraInfo{
			FileName:    "avatar-product-manager.svg",
			ContentType: iconContentType,
			FileExt:     iconExt,
			FileType:    iconFileType,
		},
	)
	if err != nil {
		return err
	}
	pmAgent, pmAgentInstance := getAgentProductManager(pmAgentIcon)
	if err := ensureAgent(ctx, injector, pmAgent); err != nil {
		return err
	}

	skills := []seedSkillFile{
		{FileName: pmCompetitiveSkillName, Content: embeddata.ProductManagerSkillCompetitiveAnalysisZip},
		{FileName: pmSlidesSkillName, Content: embeddata.ProductManagerSkillFrontendSlidesZip},
		{FileName: pmOKRsSkillName, Content: embeddata.ProductManagerSkillSettingOKRsGoalsZip},
		{FileName: pmPRDsSkillName, Content: embeddata.ProductManagerSkillWritingPRDsZip},
	}
	if err := ensureSkill(ctx, injector, skills, pmAgent.AgentId); err != nil {
		return err
	}
	return ensureAgentInstance(ctx, injector, pmAgentInstance)
}

func ensureAgentMarketing(ctx context.Context, injector *di.Injector) error {
	projectIDStr := strconv.FormatInt(defaultProjectId, 10)
	_, marketingAgentIcon, err := ensureAsset(ctx, injector, projectIDStr,
		embeddedFile{bytes.NewReader(embeddata.MarketingIcon)},
		types.FileExtraInfo{
			FileName:    "avatar-marketing.svg",
			ContentType: iconContentType,
			FileExt:     iconExt,
			FileType:    iconFileType,
		},
	)
	if err != nil {
		return err
	}
	marketingAgent, marketingAgentInstance := getAgentMarketing(marketingAgentIcon)
	if err := ensureAgent(ctx, injector, marketingAgent); err != nil {
		return err
	}

	skills := []seedSkillFile{
		{FileName: marketingBrandSkillName, Content: embeddata.MarketingSkillBrandStorytellingZip},
		{FileName: marketingContentSkillName, Content: embeddata.MarketingSkillContentMarketingZip},
		{FileName: marketingImageSkillName, Content: embeddata.MarketingSkillImageGenerationZip},
		{FileName: marketingLaunchSkillName, Content: embeddata.MarketingSkillLaunchMarketingZip},
		{FileName: marketingPositioningSkillName, Content: embeddata.MarketingSkillPositioningMessagingZip},
	}
	if err := ensureSkill(ctx, injector, skills, marketingAgent.AgentId); err != nil {
		return err
	}
	return ensureAgentInstance(ctx, injector, marketingAgentInstance)
}
