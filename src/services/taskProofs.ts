import { getSupabaseClient } from './supabase'

export const TASK_PROOF_BUCKET = 'temporary-task-proofs'
export const MAX_TASK_PROOF_SIZE_BYTES = 4 * 1024 * 1024
export const MAX_TASK_PROOF_DIMENSION = 1600
const TASK_PROOF_QUALITY = 0.82
const SUPPORTED_TASK_PROOF_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const waitForImageLoad = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the selected image.'))
    image.src = src
  })

export async function processTaskProofFile(file: File): Promise<File> {
  if (!SUPPORTED_TASK_PROOF_TYPES.has(file.type)) {
    throw new Error('Please choose a JPG, PNG, WebP, or GIF image.')
  }

  if (file.size > MAX_TASK_PROOF_SIZE_BYTES) {
    throw new Error('The image is too large. Please choose a smaller file.')
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await waitForImageLoad(objectUrl)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const scale = Math.min(1, MAX_TASK_PROOF_DIMENSION / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not prepare the image for upload.')
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/webp', TASK_PROOF_QUALITY)
    })

    if (!blob) {
      throw new Error('Could not compress the image for upload.')
    }

    if (blob.size > MAX_TASK_PROOF_SIZE_BYTES) {
      throw new Error('The compressed image is still too large. Please choose a smaller file.')
    }

    const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'proof'
    return new File([blob], `${safeName}.webp`, { type: blob.type, lastModified: Date.now() })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function buildTaskProofPath(
  familyId: string,
  taskId: string,
  childId: string,
  proofId: string,
  fileName: string,
) {
  const safeFileName = fileName.replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase()
  return `family/${familyId}/task/${taskId}/child/${childId}/proof/${proofId}-${safeFileName}`
}

export async function uploadTaskProof(
  familyId: string,
  taskId: string,
  childId: string,
  proofId: string,
  file: File,
) {
  const supabase = getSupabaseClient()
  const processedFile = await processTaskProofFile(file)
  const path = buildTaskProofPath(familyId, taskId, childId, proofId, processedFile.name)

  const { error } = await supabase.storage.from(TASK_PROOF_BUCKET).upload(path, processedFile, {
    contentType: processedFile.type,
    upsert: true,
    cacheControl: '60',
  })

  if (error) {
    throw new Error(error.message)
  }

  return path
}

export async function createTaskProofSignedUrl(path: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage.from(TASK_PROOF_BUCKET).createSignedUrl(path, 60 * 60)

  if (error) {
    throw new Error(error.message)
  }

  return data.signedUrl
}

export async function deleteTaskProof(path: string) {
  const supabase = getSupabaseClient()
  const { error } = await supabase.storage.from(TASK_PROOF_BUCKET).remove([path])

  if (error) {
    throw new Error(error.message)
  }
}
