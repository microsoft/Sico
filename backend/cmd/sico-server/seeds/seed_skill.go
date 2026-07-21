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
	"context"
	"errors"
	"fmt"
	"sort"

	"sico-backend/internal/di"
	skillrepo "sico-backend/internal/store/skill/repository"
	skilldto "sico-backend/internal/transport/http/dto/skill"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/logger"
)

// ensureSkill uploads each skill archive as an unscoped project asset and
// ensures a skill record bound to `agentId` exists via the skill application
// service. The app layer is used (rather than the repository) because it
// handles zip extraction via the core gRPC `ExtractSkill` call after the
// record is created or its asset_id changes.
func ensureSkill(ctx context.Context, injector *di.Injector, skillFiles []seedSkillFile, agentId string) error {
	if injector == nil || injector.SkillApp == nil {
		return errors.New("ensureSkill: skill service not initialized")
	}
	if agentId == "" {
		return errors.New("ensureSkill: agentId is required")
	}

	// 1) Upload the skill archive as an unscoped project asset (idempotent).
	assetIds, err := uploadSkillAssets(ctx, injector, skillFiles)
	if err != nil {
		return err
	}

	// CreateSkill / UpdateSkill expect an authenticated user in context.
	skillCtx := context.WithValue(ctx, middleware.ContextUserKey, jwtx.UserInfo{Name: defaultSystemUser})

	// 2) Look up any existing skill bound to this agent.
	listResp, err := injector.SkillApp.ListSkills(skillCtx, &skilldto.ListSkillRequest{
		AgentId:  agentId,
		Page:     1,
		PageSize: 100,
	})
	if err != nil {
		return fmt.Errorf("ensureSkill: list existing skills: %w", err)
	}

	existingSkills := append([]*skilldto.Skill(nil), listResp.GetData().GetSkills()...)
	sort.Slice(existingSkills, func(i, j int) bool { return existingSkills[i].GetId() < existingSkills[j].GetId() })

	// 3) Update existing skill records in place; create rows only when adding more seed skills.
	for i, assetID := range assetIds {
		if err := syncSkillRecord(ctx, skillCtx, injector, existingSkills, i, assetID, agentId); err != nil {
			return err
		}
	}

	return nil
}

// uploadSkillAssets uploads each skill file as an unscoped project asset and
// returns the corresponding asset IDs.
func uploadSkillAssets(ctx context.Context, injector *di.Injector, skillFiles []seedSkillFile) ([]int64, error) {
	assetIds := make([]int64, 0, len(skillFiles))
	for i, skillFile := range skillFiles {
		if skillFile.FileName == "" {
			return nil, fmt.Errorf("ensureSkill: skill file %d missing filename", i)
		}
		if len(skillFile.Content) == 0 {
			return nil, fmt.Errorf("ensureSkill: %s is empty", skillFile.FileName)
		}
		assetID, _, err := ensureAsset(ctx, injector, "",
			embeddedFile{skillFile.asReader()},
			skillFile.asExtraInfo(),
		)
		if err != nil {
			return nil, fmt.Errorf("ensureSkill: upload asset %d: %w", i, err)
		}
		assetIds = append(assetIds, assetID)
	}
	return assetIds, nil
}

// syncSkillRecord creates or updates a single skill record to match the
// expected asset ID. When index exceeds the number of existing skills a new
// record is created; otherwise the existing record is updated only when the
// underlying asset has changed.
func syncSkillRecord(
	ctx context.Context,
	skillCtx context.Context,
	injector *di.Injector,
	existingSkills []*skilldto.Skill,
	index int,
	assetID int64,
	agentId string,
) error {
	if index >= len(existingSkills) {
		if _, err := injector.SkillApp.CreateSkill(skillCtx, &skilldto.CreateSkillRequest{
			AgentId: agentId,
			AssetId: assetID,
		}); err != nil {
			return fmt.Errorf("ensureSkill: create skill: %w", err)
		}
		logger.CtxInfo(ctx, "ensureSkill: created skill for agent %s with asset %d", agentId, assetID)
		return nil
	}

	existing := existingSkills[index]
	currentVersion, currentAssetID, err := currentSkillVersionForSeed(skillCtx, injector, existing.GetId())
	if err != nil {
		return err
	}
	if currentAssetID == assetID {
		logger.CtxInfo(
			ctx,
			"ensureSkill: skipped unchanged skill %d for agent %s asset=%d",
			existing.GetId(), agentId, assetID,
		)
		return nil
	}
	if _, err := injector.SkillApp.UpdateSkill(skillCtx, &skilldto.UpdateSkillRequest{
		Id:             existing.GetId(),
		AssetId:        assetID,
		CurrentVersion: currentVersion,
	}); err != nil {
		return fmt.Errorf("ensureSkill: update skill %d: %w", existing.GetId(), err)
	}
	logger.CtxInfo(
		ctx,
		"ensureSkill: updated skill %d for agent %s asset %d -> %d",
		existing.GetId(), agentId, currentAssetID, assetID,
	)
	return nil
}

func currentSkillVersionForSeed(
	ctx context.Context,
	injector *di.Injector,
	skillID int64,
) (string, int64, error) {
	if injector.DB == nil {
		return "", 0, errors.New("ensureSkill: database not initialized")
	}
	version, err := skillrepo.NewSkillRepo(injector.DB).GetLatestVersion(ctx, skillID)
	if err != nil {
		return "", 0, fmt.Errorf("ensureSkill: get latest version for skill %d: %w", skillID, err)
	}
	if version == nil || version.Version == "" {
		return "", 0, fmt.Errorf("ensureSkill: skill %d has no current version", skillID)
	}
	return version.Version, version.AssetID, nil
}
