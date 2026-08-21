package seeds

import (
	"context"

	"gorm.io/gorm"

	"sico-backend/internal/biz/rbac"
	"sico-backend/internal/di"
	projectrepo "sico-backend/internal/store/project/repository"
	projectdto "sico-backend/internal/transport/http/dto/project"
	"sico-backend/pkg/logger"
)

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
		existingProject.CreatorUsername != expected.CreatorUsername ||
		existingProject.OrganizationID != expected.OrganizationID {
		if err = repo.UpdateProject(ctx, expected); err != nil {
			return err
		}
	}

	return nil
}

func ensureProjectMembership(ctx context.Context, injector *di.Injector, projectID int64, username string, role int32) error {
	roleCode := rbac.RoleProjectMember
	if role == int32(projectdto.MemberType_MEMBER_TYPE_ADMIN) {
		roleCode = rbac.RoleProjectAdmin
	}
	if err := rbac.AssignProjectRole(ctx, username, roleCode, projectID); err != nil {
		logger.CtxWarn(ctx, "ensureProjectMembership: RBAC assign role=%s user=%s project=%d: %v (non-fatal)",
			roleCode, username, projectID, err)
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
