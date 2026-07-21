package dal

import (
	"context"

	"sico-backend/internal/store/project/internal/dal/model"
	projectdto "sico-backend/internal/transport/http/dto/project"
)

func (dao *ProjectDAO) AddProjectUser(ctx context.Context, project *model.TProjectUser) error {
	return dao.query.TProjectUser.WithContext(ctx).Create(project)
}

func (dao *ProjectDAO) DeleteProjectUsers(ctx context.Context, projectID int64) error {
	dam := dao.query.TProjectUser
	_, err := dam.WithContext(ctx).Where(dam.ProjectID.Eq(projectID)).Delete()
	return err
}

func (dao *ProjectDAO) GetUserProjectList(ctx context.Context, username string) ([]*model.TProjectUser, error) {
	return dao.query.TProjectUser.WithContext(ctx).Where(
		dao.query.TProjectUser.Username.Eq(username),
	).Find()
}

func (dao *ProjectDAO) GetUserProjectListWithPagination(
	ctx context.Context,
	username string, memberType int32,
	page, pageSize int32,
) ([]*model.TProjectUser, int64, error) {
	query := dao.query.TProjectUser.WithContext(ctx).Where(
		dao.query.TProjectUser.Username.Eq(username),
	)

	if memberType != int32(projectdto.MemberType_MEMBER_TYPE_UNKNOWN) && memberType != 0 {
		roleCol := dao.query.TProjectUser.RoleType
		// special handling for member role to include both member and admin roles
		if memberType == int32(projectdto.MemberType_MEMBER_TYPE_MEMBER) {
			query = query.Where(roleCol.In(
				int32(projectdto.MemberType_MEMBER_TYPE_MEMBER),
				int32(projectdto.MemberType_MEMBER_TYPE_ADMIN),
			))
		} else {
			query = query.Where(roleCol.Eq(memberType))
		}
	}

	total, err := query.Count()
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	results, err := query.Offset(int(offset)).Limit(int(pageSize)).Find()
	if err != nil {
		return nil, 0, err
	}

	return results, total, nil
}

// DeleteProjectAdmins removes all admin members for a given project.
func (dao *ProjectDAO) DeleteProjectAdmins(ctx context.Context, projectID int64) error {
	dam := dao.query.TProjectUser
	const roleTypeAdmin = int32(projectdto.MemberType_MEMBER_TYPE_ADMIN)
	_, err := dam.WithContext(ctx).Where(
		dam.ProjectID.Eq(projectID),
		dam.RoleType.Eq(roleTypeAdmin),
	).Delete()
	return err
}

// DeleteProjectAdminsByUsernames removes specific admins for a given project.
func (dao *ProjectDAO) DeleteProjectAdminsByUsernames(ctx context.Context, projectID int64, usernames []string) error {
	if len(usernames) == 0 {
		return nil
	}

	dam := dao.query.TProjectUser
	const roleTypeAdmin = int32(projectdto.MemberType_MEMBER_TYPE_ADMIN)
	_, err := dam.WithContext(ctx).Where(
		dam.ProjectID.Eq(projectID),
		dam.RoleType.Eq(roleTypeAdmin),
		dam.Username.In(usernames...),
	).Delete()
	return err
}

// AddProjectAdminsByUsernames adds admin memberships in batch for the given project.
func (dao *ProjectDAO) AddProjectAdminsByUsernames(ctx context.Context, projectID int64, usernames []string) error {
	if len(usernames) == 0 {
		return nil
	}

	const roleTypeAdmin = int32(projectdto.MemberType_MEMBER_TYPE_ADMIN)
	batch := make([]*model.TProjectUser, 0, len(usernames))
	for _, username := range usernames {
		if username == "" {
			continue
		}
		batch = append(batch, &model.TProjectUser{
			ProjectID: projectID,
			Username:  username,
			RoleType:  roleTypeAdmin,
		})
	}

	if len(batch) == 0 {
		return nil
	}

	return dao.query.TProjectUser.WithContext(ctx).Create(batch...)
}

// GetProjectAdminUsernames returns usernames of admins for each project id provided.
func (dao *ProjectDAO) GetProjectAdminUsernames(ctx context.Context, projectIDs []int64) (map[int64][]string, error) {
	if len(projectIDs) == 0 {
		return map[int64][]string{}, nil
	}

	const roleTypeAdmin = int32(projectdto.MemberType_MEMBER_TYPE_ADMIN)
	rows, err := dao.query.TProjectUser.WithContext(ctx).Where(
		dao.query.TProjectUser.ProjectID.In(projectIDs...),
		dao.query.TProjectUser.RoleType.Eq(roleTypeAdmin),
	).Find()
	if err != nil {
		return nil, err
	}

	admins := make(map[int64][]string, len(projectIDs))
	for _, row := range rows {
		admins[row.ProjectID] = append(admins[row.ProjectID], row.Username)
	}

	return admins, nil
}

// GetProjectIDsByAdminUsername returns project IDs where the given username is admin.
func (dao *ProjectDAO) GetProjectIDsByAdminUsername(ctx context.Context, username string) ([]int64, error) {
	if username == "" {
		return []int64{}, nil
	}

	const roleTypeAdmin = int32(projectdto.MemberType_MEMBER_TYPE_ADMIN)
	rows, err := dao.query.TProjectUser.WithContext(ctx).Where(
		dao.query.TProjectUser.Username.Eq(username),
		dao.query.TProjectUser.RoleType.Eq(roleTypeAdmin),
	).Find()
	if err != nil {
		return nil, err
	}

	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ProjectID)
	}

	return ids, nil
}

// ListProjectMemberUsernames returns all usernames belonging to a project.
func (dao *ProjectDAO) ListProjectMemberUsernames(ctx context.Context, projectID int64) ([]string, error) {
	rows, err := dao.query.TProjectUser.WithContext(ctx).Where(
		dao.query.TProjectUser.ProjectID.Eq(projectID),
	).Find()
	if err != nil {
		return nil, err
	}

	usernames := make([]string, 0, len(rows))
	for _, row := range rows {
		usernames = append(usernames, row.Username)
	}

	return usernames, nil
}
