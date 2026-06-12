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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"sort"
	"strconv"
	"time"

	"gorm.io/gorm"

	"sico-backend/internal/biz/sandbox"
	"sico-backend/internal/di"
	"sico-backend/internal/embeddata"
	agententity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/infra/storage"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/shared/types"
	agentrepo "sico-backend/internal/store/agent/singleagent/repository"
	projectrepo "sico-backend/internal/store/project/repository"
	userrepo "sico-backend/internal/store/rbac/repository"
	skillrepo "sico-backend/internal/store/skill/repository"
	agentdto "sico-backend/internal/transport/http/dto/agent/single_agent"
	projectdto "sico-backend/internal/transport/http/dto/project"
	rbacCommon "sico-backend/internal/transport/http/dto/rbac/common"
	skilldto "sico-backend/internal/transport/http/dto/skill"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/crypto/hash"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/logger"
)

const (
	projectDefaultIconName = "project-default.svg"

	iconContentType = "image/svg+xml"
	iconExt         = "svg"
	iconFileType    = "image"

	androidTesterSkillName        = "android-tester.zip"
	testCasesRewriteSkillName     = "test-cases-rewrite.zip"
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

// ---------- Required Data ------------

func getDefaultProject(iconURI string) *projectrepo.ProjectModel {
	return &projectrepo.ProjectModel{
		ID:            defaultProjectId,
		OwnerUsername: defaultSystemUser,
		Name:          "SICO",
		Description: "This is the default project that contains all assets without specific project assignment. " +
			"It is created by the system and cannot be deleted.",
		IconURI:         iconURI,
		CreatorUsername: defaultSystemUser,
		DeletedAt:       gorm.DeletedAt{Valid: false},
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

// ensureAsset uploads `file` as a project asset under `projectID`, deduplicating
// against existing assets that share the same FileName + SHA-256 digest. The
// SHA-256 in `extra` is computed automatically when empty. Returns the
// asset's database ID and storage URI ("<projectId>/<objectKey>").
//
// `projectID` may be empty: in that case the asset is uploaded with no project
// scope and dedup is performed against other unscoped assets sharing the same
// FileName.
func ensureAsset(
	ctx context.Context,
	injector *di.Injector,
	projectID string,
	file multipart.File,
	extra types.FileExtraInfo,
) (int64, string, error) {
	if injector == nil || injector.ProjectApp == nil {
		return 0, "", errors.New("ensureAsset: project service not initialized")
	}
	if file == nil {
		return 0, "", errors.New("ensureAsset: file is nil")
	}
	if extra.FileName == "" {
		return 0, "", errors.New("ensureAsset: FileName is required")
	}

	// Read full content so we can hash it and re-feed the upload path.
	content, err := readAll(file)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: read content: %w", err)
	}
	if len(content) == 0 {
		return 0, "", fmt.Errorf("ensureAsset: %s is empty", extra.FileName)
	}

	if extra.SHA256 == "" {
		sum := sha256.Sum256(content)
		extra.SHA256 = hex.EncodeToString(sum[:])
	}
	if extra.FileSize == 0 {
		extra.FileSize = int64(len(content))
	}

	// Normalize empty projectID to the storage default. Asset rows persisted
	// from an empty request store the column default ("default_space"), so
	// querying with "" misses them and we'd re-upload on every restart.
	if projectID == "" {
		projectID = storage.DefaultPathPrefix
	}

	repo := projectrepo.NewProjectRepo(injector.DB)
	existing, err := repo.GetProjectAssetList(ctx, projectID)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: list existing assets: %w", err)
	}

	if id, uri, ok := findReusableAsset(ctx, existing, extra); ok {
		return id, uri, nil
	}

	resp, err := injector.ProjectApp.AddProjectAsset(
		ctx,
		&projectdto.AddProjectAssetRequest{ProjectId: projectID},
		defaultSystemUser,
		embeddedFile{bytes.NewReader(content)},
		extra,
	)
	if err != nil {
		return 0, "", fmt.Errorf("ensureAsset: upload %s: %w", extra.FileName, err)
	}

	id := resp.GetData().GetId()
	uri := resp.GetData().GetUri()
	logger.CtxInfo(ctx, "ensureAsset: uploaded %s -> id=%d uri=%s", extra.FileName, id, uri)
	return id, uri, nil
}

// findReusableAsset scans `existing` for an asset that matches `extra` by
// FileName and SHA-256 (treating an empty stored hash as a match). Returns
// the asset id, storage URI, and true when a reusable asset is found.
func findReusableAsset(
	ctx context.Context,
	existing []*projectrepo.ProjectAssetModel,
	extra types.FileExtraInfo,
) (int64, string, bool) {
	for _, asset := range existing {
		if asset == nil || asset.Extra == "" {
			continue
		}
		var meta types.FileExtraInfo
		if jsonErr := json.Unmarshal([]byte(asset.Extra), &meta); jsonErr != nil {
			logger.CtxWarn(ctx, "ensureAsset: failed to unmarshal asset extra (id=%d): %v", asset.ID, jsonErr)
			continue
		}
		if meta.FileName != extra.FileName {
			continue
		}
		// Reuse when the recorded hash matches, or when the asset predates
		// hash tracking (empty hash) — we don't want to churn legacy rows on
		// first upgrade.
		if meta.SHA256 == "" || meta.SHA256 == extra.SHA256 {
			uri := fmt.Sprintf("%s/%s", asset.ProjectID, asset.ObjectKey)
			return asset.ID, uri, true
		}
		logger.CtxInfo(ctx,
			"ensureAsset: %s content changed (old=%s new=%s); re-uploading",
			extra.FileName, meta.SHA256, extra.SHA256)
	}
	return 0, "", false
}

// readAll reads the entire content of a multipart.File. It rewinds the
// reader first when supported so callers can pass freshly opened files.
func readAll(file multipart.File) ([]byte, error) {
	if seeker, ok := file.(interface {
		Seek(offset int64, whence int) (int64, error)
	}); ok {
		_, _ = seeker.Seek(0, 0)
	}
	buf := bytes.NewBuffer(nil)
	if _, err := buf.ReadFrom(file); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func checkDefaultOperatorUser(ctx context.Context, injector *di.Injector) error {
	repo := userrepo.NewUserRepository(injector.DB)

	existingUser, err := repo.GetUserByUsername(ctx, defaultOperatorUser)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	if existingUser != nil {
		return nil
	}
	return createDefaultOperatorUser(ctx, injector, repo)
}

func createDefaultOperatorUser(ctx context.Context, injector *di.Injector, repo userrepo.UserRepository) error {
	hashedPassword, err := hash.GeneratePassword(defaultOperatorPassword)
	if err != nil {
		return err
	}

	u := &userrepo.UserModel{
		Username: defaultOperatorUser,
		Alias_:   defaultOperatorAlias,
		Password: hashedPassword,
		Email:    defaultOperatorEmail,
		Status:   int32(rbacCommon.UserStatus_USER_STATUS_ACTIVE),
	}

	err = repo.CreateUser(ctx, u)
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrDuplicatedKey) {
		return err
	}

	logger.CtxWarn(ctx, "Default operator user already exists but is marked as deleted, trying to recover it")
	injector.DB.WithContext(ctx).Exec(
		"UPDATE t_user SET deleted_at = null WHERE username = ?", defaultOperatorUser)

	// update other fields to make sure the default operator user is correct
	return repo.UpdateUser(ctx, u)
}

func ensureProject(ctx context.Context, injector *di.Injector, expected *projectrepo.ProjectModel) error {
	repo := projectrepo.NewProjectRepo(injector.DB)

	existingProject, err := repo.GetProjectByID(ctx, expected.ID)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	if existingProject == nil {
		return createOrRecoverProject(ctx, injector, repo, expected)
	}

	// check if the project needs to be updated
	if existingProject.Name != expected.Name ||
		existingProject.Description != expected.Description ||
		existingProject.IconURI != expected.IconURI ||
		existingProject.OwnerUsername != expected.OwnerUsername ||
		existingProject.CreatorUsername != expected.CreatorUsername {
		if err = repo.UpdateProject(ctx, expected); err != nil {
			return err
		}
	}

	return nil
}

func ensureProjectMembership(ctx context.Context, injector *di.Injector, projectID int64, username string, role int32) error {
	repo := projectrepo.NewProjectRepo(injector.DB)

	membership := &projectrepo.ProjectUserModel{
		ProjectID: projectID,
		Username:  username,
		RoleType:  role,
	}

	if err := repo.AddProjectUser(ctx, membership); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil
		}
		return err
	}
	return nil
}

func createOrRecoverProject(
	ctx context.Context,
	injector *di.Injector,
	repo projectrepo.ProjectRepository,
	expected *projectrepo.ProjectModel,
) error {
	err := repo.CreateProject(ctx, expected)
	if err == nil {
		return nil
	}
	if err != gorm.ErrDuplicatedKey {
		return err
	}

	// the project exists but is deleted (deleted_at not null); recover it
	// by clearing deleted_at and updating the record with correct info.
	logger.CtxWarn(ctx,
		"Project %d already exists but is marked as deleted, trying to recover it",
		expected.ID)
	injector.DB.WithContext(ctx).Exec(
		"UPDATE t_project SET deleted_at = null WHERE id = ?", expected.ID)

	return repo.UpdateProject(ctx, expected)
}

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

// checkSandboxAssigned unbinds any existing sandbox bindings from the
// default agent instance and then assigns the first allocatable emulator
// sandbox. All errors are logged and swallowed by the caller — this is
// best-effort.
func checkSandboxAssigned(ctx context.Context, agentInstanceID int64) error {
	svc := sandbox.Default()
	if svc == nil {
		logger.CtxInfo(ctx, "checkDefaultSandboxAssignment: sandbox service not initialized; skipping")
		return nil
	}

	instanceID := strconv.FormatInt(agentInstanceID, 10)

	// Always clean up existing bindings so we get a fresh assignment.
	if err := svc.CleanupInstanceSandboxes(ctx, instanceID); err != nil {
		logger.CtxWarn(ctx, "checkDefaultSandboxAssignment: cleanup existing bindings failed: %v", err)
	}

	pickedID, err := pollAllocatableEmulator(ctx, svc)
	if err != nil {
		return err
	}
	if pickedID == "" {
		logger.CtxInfo(ctx,
			"checkDefaultSandboxAssignment: no allocatable emulator sandbox found; "+
				"default agent instance %s left unbound",
			instanceID)
		return nil
	}

	if err := svc.AssignSandbox(ctx, instanceID, pickedID); err != nil {
		return err
	}

	logger.CtxInfo(ctx,
		"checkDefaultSandboxAssignment: bound sandbox %s to default agent instance %s",
		pickedID, instanceID)
	return nil
}

// pollAllocatableEmulator polls the sandbox pool for a short window waiting
// for the background snapshot refresh to report at least one allocatable
// emulator. Returns the picked sandbox ID (or "" if none became available)
// and propagates ctx.Err() when the context is cancelled between retries.
func pollAllocatableEmulator(ctx context.Context, svc sandbox.Service) (string, error) {
	const (
		maxAttempts   = 5
		retryInterval = 2 * time.Second
	)
	emulatorType := enum.SandboxTypeEmulator.String()

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if picked := pickAllocatableEmulator(ctx, svc, emulatorType, attempt, maxAttempts); picked != "" {
			return picked, nil
		}
		if attempt == maxAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(retryInterval):
		}
	}
	return "", nil
}

// pickAllocatableEmulator performs a single ListAllResources scan and returns
// the first allocatable emulator's sandbox_id, or "" if none is found.
func pickAllocatableEmulator(ctx context.Context, svc sandbox.Service, emulatorType string, attempt, maxAttempts int) string {
	resourcesByType, listErr := svc.ListAllResources(ctx)
	if listErr != nil {
		logger.CtxInfo(ctx,
			"checkDefaultSandboxAssignment: ListAllResources attempt %d/%d not ready: %v",
			attempt, maxAttempts, listErr)
		return ""
	}
	emulators, _ := resourcesByType[emulatorType].([]map[string]interface{})
	for _, r := range emulators {
		alloc, _ := r["allocatable"].(bool)
		if !alloc {
			continue
		}
		if sid, _ := r["sandbox_id"].(string); sid != "" {
			return sid
		}
	}
	logger.CtxInfo(ctx,
		"checkDefaultSandboxAssignment: no allocatable emulator yet (attempt %d/%d)",
		attempt, maxAttempts)
	return ""
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
	testCasesRewriteSkillBytes, err := embeddata.TestCasesRewriteSkillZip()
	if err != nil {
		return err
	}
	skills := []seedSkillFile{
		{FileName: androidTesterSkillName, Content: androidTesterSkillBytes},
		{FileName: testCasesRewriteSkillName, Content: testCasesRewriteSkillBytes},
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

func Run(ctx context.Context, injector *di.Injector) error {
	err := checkDefaultOperatorUser(ctx, injector)
	if err != nil {
		return err
	}

	// Upload default icons (idempotent) before the project/instance records
	// are created/updated so that their IconURI fields can reference them.
	// Asset rows have no FK to t_project, so this is safe even on first run.
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

	if err := ensureProject(ctx, injector, getDefaultProject(projectIconURI)); err != nil {
		return err
	}

	if err := ensureProjectMembership(
		ctx,
		injector,
		defaultProjectId,
		defaultOperatorUser,
		int32(projectdto.MemberType_MEMBER_TYPE_MEMBER),
	); err != nil {
		return err
	}

	err = ensureAgentAndroidTester(ctx, injector)
	if err != nil {
		return err
	}

	err = ensureAgent3DArtist(ctx, injector)
	if err != nil {
		return err
	}

	err = ensureAgentProductManager(ctx, injector)
	if err != nil {
		return err
	}

	err = ensureAgentMarketing(ctx, injector)
	if err != nil {
		return err
	}

	return nil
}

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
			embeddedFile{bytes.NewReader(skillFile.Content)},
			types.FileExtraInfo{
				FileName:    skillFile.FileName,
				ContentType: defaultSkillContentType,
				FileExt:     defaultSkillExt,
				FileType:    defaultSkillFileType,
			},
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
