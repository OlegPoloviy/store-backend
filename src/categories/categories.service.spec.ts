import { ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const uploadSingleFile = jest.fn();
  const deleteFilesByUrls = jest.fn();
  const service = new CategoriesService(
    { category: { findUnique, update } } as any,
    { uploadSingleFile, deleteFilesByUrls } as any,
  );

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    uploadSingleFile.mockReset();
    deleteFilesByUrls.mockReset();
  });

  it('updates the name without changing the image', async () => {
    findUnique.mockResolvedValue({
      id: '1',
      name: 'Chairs',
      categoryImage: 'old-url',
    });
    const updated = { id: '1', name: 'Tables', categoryImage: 'old-url' };
    update.mockResolvedValue(updated);

    await expect(
      service.updateCategory('1', { name: 'Tables' }),
    ).resolves.toEqual(updated);
    expect(update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { name: 'Tables' },
      select: { id: true, name: true, categoryImage: true },
    });
    expect(deleteFilesByUrls).not.toHaveBeenCalled();
  });

  it('replaces the image and removes the previous file', async () => {
    findUnique.mockResolvedValue({
      id: '1',
      name: 'Chairs',
      categoryImage: 'old-url',
    });
    uploadSingleFile.mockResolvedValue({ url: 'new-url' });
    update.mockResolvedValue({
      id: '1',
      name: 'Chairs',
      categoryImage: 'new-url',
    });
    const file = { originalname: 'chairs.png' } as Express.Multer.File;

    await service.updateCategory('1', {}, file);

    expect(uploadSingleFile).toHaveBeenCalledWith(file, 'categories');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { categoryImage: 'new-url' },
      }),
    );
    expect(deleteFilesByUrls).toHaveBeenCalledWith(['old-url']);
  });

  it('returns 404 without uploading when the category is missing', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.updateCategory('missing', { name: 'Tables' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploadSingleFile).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 409 for a duplicate category name', async () => {
    findUnique.mockResolvedValue({
      id: '1',
      name: 'Chairs',
      categoryImage: null,
    });
    update.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.updateCategory('1', { name: 'Tables' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
