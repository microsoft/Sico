package dal

import (
	"context"
	"fmt"

	"sico-backend/internal/store/project/internal/dal/model"
)

func (dao *ProjectDAO) AddProjectAsset(ctx context.Context, projectAsset *model.TProjectAsset) (int64, error) {
	err := dao.query.TProjectAsset.WithContext(ctx).Create(projectAsset)
	if err != nil {
		return 0, err
	}

	return projectAsset.ID, nil
}

func (dao *ProjectDAO) DeleteProjectAsset(ctx context.Context, id int64) error {
	dam := dao.query.TProjectAsset
	_, err := dam.WithContext(ctx).Where(dam.ID.Eq(id)).Delete()

	return err
}

func (dao *ProjectDAO) GetUserProjectAssetList(ctx context.Context, username, projectID string) ([]*model.TProjectAsset, error) {
	if len(username) == 0 && len(projectID) == 0 {
		return nil, fmt.Errorf("failed to GetUserProjectAssetList, params are empty")
	}

	query := dao.query.TProjectAsset.WithContext(ctx)
	if len(username) > 0 {
		query = query.Where(dao.query.TProjectAsset.CreatorUsername.Eq(username))
	}
	if len(projectID) > 0 {
		query = query.Where(dao.query.TProjectAsset.ProjectID.Eq(projectID))
	}

	return query.Find()
}

func (dao *ProjectDAO) GetUserProjectAssetListWithPagination(
	ctx context.Context, username, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error) {
	if len(username) == 0 && len(projectID) == 0 {
		return nil, 0, fmt.Errorf("failed to GetUserProjectAssetList, params are empty")
	}

	query := dao.query.TProjectAsset.WithContext(ctx)
	if len(username) > 0 {
		query = query.Where(dao.query.TProjectAsset.CreatorUsername.Eq(username))
	}
	if len(projectID) > 0 {
		query = query.Where(dao.query.TProjectAsset.ProjectID.Eq(projectID))
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

func (dao *ProjectDAO) GetProjectAssetList(ctx context.Context, projectID string) ([]*model.TProjectAsset, error) {
	return dao.query.TProjectAsset.WithContext(ctx).Where(
		dao.query.TProjectAsset.ProjectID.Eq(projectID),
	).Find()
}

func (dao *ProjectDAO) GetProjectAsset(ctx context.Context, id int64) (*model.TProjectAsset, error) {
	return dao.query.TProjectAsset.WithContext(ctx).Where(
		dao.query.TProjectAsset.ID.Eq(id),
	).First()
}

func (dao *ProjectDAO) GetProjectAssetListWithPagination(
	ctx context.Context, projectID string, page, pageSize int32) ([]*model.TProjectAsset, int64, error) {
	query := dao.query.TProjectAsset.WithContext(ctx).Where(
		dao.query.TProjectAsset.ProjectID.Eq(projectID),
	)

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
